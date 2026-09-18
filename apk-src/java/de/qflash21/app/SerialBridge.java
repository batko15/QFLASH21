package de.qflash21.app;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;
import android.webkit.JavascriptInterface;

import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * QFLASH21 – Native USB-Serial-Bridge für die Weboberfläche.
 *
 * Wird per addJavascriptInterface als "window.QfSerialBridge" exponiert und
 * implementiert exakt die Funktionen, die die Web-App sonst über Web Serial /
 * WebUSB abwickelt – nur eben NATIV über die Android USB-Host-API:
 *
 *   listDevices()            → JSON-Array kompatibler Adapter
 *   requestAndOpen(v,p,baud) → USB-Berechtigung + Treiber-Init, JSON
 *   write(base64)            → Bulk-OUT
 *   read(maxBytes)           → Bulk-OUT-Empfangspuffer als Base64 (nicht-blockierend)
 *   setBreak(bool)           → K-Line-BREAK (5-Baud-Init)
 *   close()/isOpen()/deviceInfo()
 *
 * Alle Methoden sind bewusst klein und blockierfrei (außer der Berechtigungs-
 * Abfrage mit Timeout), damit der JS-Seitige KWP2000-Stack unverändert läuft.
 */
public class SerialBridge {

    private static final String ACTION_USB_PERMISSION = "de.qflash21.app.USB_PERMISSION";
    private static final int RX_RING_SIZE = 65536;

    private final Context ctx;
    private final UsbManager usbManager;

    private final Object stateLock = new Object();
    private final Object rxLock = new Object();
    private final AtomicBoolean running = new AtomicBoolean(false);

    private UsbSerialDriver driver = null;
    private UsbDeviceConnection conn = null;
    private UsbDevice device = null;

    // Ringpuffer für RX (drop-oldest)
    private final byte[] ring = new byte[RX_RING_SIZE];
    private int ringHead = 0; // Leseposition
    private int ringCount = 0;

    private Thread rxThread = null;
    private volatile PendingIntent permissionIntent = null;
    private volatile Boolean lastPermissionResult = null;

    public SerialBridge(Context context) {
        this.ctx = context.getApplicationContext();
        this.usbManager = (UsbManager) ctx.getSystemService(Context.USB_SERVICE);
    }

    /* ------------------------- JS-API ------------------------- */

    @JavascriptInterface
    public String listDevices() {
        StringBuilder sb = new StringBuilder("[");
        boolean first = true;
        try {
            Map<String, UsbDevice> list = usbManager.getDeviceList();
            if (list != null) {
                for (UsbDevice d : list.values()) {
                    String kind = UsbSerialDriver.kindFor(d.getVendorId(), d.getProductId());
                    if (kind == null) continue;
                    if (!first) sb.append(',');
                    first = false;
                    sb.append("{\"vendorId\":").append(d.getVendorId())
                      .append(",\"productId\":").append(d.getProductId())
                      .append(",\"name\":\"").append(jsonEsc(d.getDeviceName()))
                      .append("\",\"driver\":\"").append(kind)
                      .append("\",\"hasPermission\":").append(usbManager.hasPermission(d))
                      .append('}');
                }
            }
        } catch (Throwable t) {
            // leer zurückgeben
        }
        return sb.append(']').toString();
    }

    /** Öffnet Adapter (inkl. USB-Berechtigungsdialog falls nötig). Rückgabe: JSON. */
    @JavascriptInterface
    public String requestAndOpen(int vendorId, int productId, int baud) {
        synchronized (stateLock) {
            closeLocked();
            UsbDevice dev = findDevice(vendorId, productId);
            if (dev == null) {
                return err("Kein kompatibler USB-Adapter gefunden (0x" + hex(vendorId) + ":0x" + hex(productId)
                        + "). K+DCAN-Kabel per USB-OTG anschließen und erneut versuchen.");
            }
            if (!usbManager.hasPermission(dev)) {
                Boolean granted = requestPermissionBlocking(dev);
                if (granted == null || !granted) {
                    return err("USB-Berechtigung nicht erteilt (Dialog bestätigen oder Timeout).");
                }
            }
            UsbDeviceConnection c = usbManager.openDevice(dev);
            if (c == null) {
                return err("USB-Gerät konnte nicht geöffnet werden (wird es von einer anderen App belegt?).");
            }
            try {
                UsbSerialDriver drv = UsbSerialDriver.create(dev, c);
                if (drv == null) {
                    try { c.close(); } catch (Throwable ignored) { }
                    return err("Kein Bulk-IN/OUT-Endpoint am Adapter gefunden (FTDI/CH340/CP2102 nötig).");
                }
                String openErr = drv.open(baud);
                if (openErr != null) {
                    try { c.close(); } catch (Throwable ignored) { }
                    return err("Adapter-Init fehlgeschlagen: " + openErr);
                }
                this.driver = drv;
                this.conn = c;
                this.device = dev;
                synchronized (rxLock) {
                    ringHead = 0;
                    ringCount = 0;
                }
                startRx();
                return ok("{\"vendorId\":" + vendorId
                        + ",\"productId\":" + productId
                        + ",\"driver\":\"" + drv.kind()
                        + "\",\"name\":\"" + jsonEsc(dev.getDeviceName()) + "\"}");
            } catch (Throwable t) {
                try { c.close(); } catch (Throwable ignored) { }
                return err("Öffnen fehlgeschlagen: " + t);
            }
        }
    }

    /** Nutzdaten schreiben (Base64). Rückgabe: JSON. */
    @JavascriptInterface
    public String write(String base64) {
        UsbSerialDriver drv = this.driver;
        if (drv == null || !running.get()) return err("Adapter nicht geöffnet.");
        byte[] data;
        try {
            data = Base64.decode(base64, Base64.NO_WRAP);
        } catch (Throwable t) {
            return err("Ungültige Nutzdaten (Base64).");
        }
        if (data.length == 0) return ok("{\"written\":0}");
        int total = 0;
        try {
            // Bulk-Transfers in ≤ 4096-Byte-Häppchen (USB-Paketgrenzen)
            int off = 0;
            while (off < data.length) {
                int len = Math.min(4096, data.length - off);
                byte[] chunk = new byte[len];
                System.arraycopy(data, off, chunk, 0, len);
                int n = drv.writeChunk(chunk, len);
                if (n < 0) {
                    return err("USB-Schreiben fehlgeschlagen (" + total + "/" + data.length + " Bytes).");
                }
                total += n;
                off += len;
            }
        } catch (Throwable t) {
            return err("USB-Schreiben fehlgeschlagen: " + t);
        }
        return ok("{\"written\":" + total + "}");
    }

    /** Empfangspuffer lesen (nicht-blockierend, max. maxBytes) – Base64 oder "". */
    @JavascriptInterface
    public String read(int maxBytes) {
        if (driver == null || !running.get()) return "";
        if (maxBytes <= 0) maxBytes = 256;
        synchronized (rxLock) {
            int take = Math.min(maxBytes, ringCount);
            if (take <= 0) return "";
            byte[] out = new byte[take];
            for (int i = 0; i < take; i++) {
                out[i] = ring[(ringHead + i) % RX_RING_SIZE];
            }
            ringHead = (ringHead + take) % RX_RING_SIZE;
            ringCount -= take;
            return Base64.encodeToString(out, Base64.NO_WRAP);
        }
    }

    /** BREAK (K-Line-Low) setzen/entfernen – für den 5-Baud-Init. */
    @JavascriptInterface
    public String setBreak(boolean on) {
        UsbSerialDriver drv = this.driver;
        if (drv == null) return err("Adapter nicht geöffnet.");
        String e = drv.setBreak(on);
        return e != null ? err(e) : ok("{\"break\":" + on + "}");
    }

    @JavascriptInterface
    public boolean isOpen() {
        return driver != null && running.get();
    }

    @JavascriptInterface
    public String deviceInfo() {
        UsbSerialDriver drv = this.driver;
        if (drv == null) return "{}";
        return "{\"vendorId\":" + device.getVendorId()
                + ",\"productId\":" + device.getProductId()
                + ",\"driver\":\"" + drv.kind()
                + "\",\"name\":\"" + jsonEsc(device.getDeviceName()) + "\"}";
    }

    @JavascriptInterface
    public void close() {
        synchronized (stateLock) {
            closeLocked();
        }
    }

    /** Von MainActivity bei ACTION_USB_DEVICE_DETACHED aufrufen. */
    public void onDeviceDetached(int vendorId, int productId) {
        synchronized (stateLock) {
            if (device != null && device.getVendorId() == vendorId && device.getProductId() == productId) {
                closeLocked();
            }
        }
    }

    public void shutdown() {
        synchronized (stateLock) {
            closeLocked();
        }
        try {
            ctx.unregisterReceiver(permissionReceiver);
        } catch (Throwable ignored) {
            // war nicht registriert
        }
    }

    /* ------------------------- Intern ------------------------- */

    private UsbDevice findDevice(int vendorId, int productId) {
        Map<String, UsbDevice> list = usbManager.getDeviceList();
        if (list == null) return null;
        for (UsbDevice d : list.values()) {
            if (d.getVendorId() == vendorId && d.getProductId() == productId
                    && UsbSerialDriver.kindFor(d.getVendorId(), d.getProductId()) != null) {
                return d;
            }
        }
        return null;
    }

    /**
     * USB-Berechtigung blockierend anfordern (max. 20 s).
     * Rückgabe: true/false, null bei Timeout/Fehler.
     */
    private Boolean requestPermissionBlocking(UsbDevice dev) {
        final CountDownLatch latch = new CountDownLatch(1);
        lastPermissionResult = null;
        try {
            try {
                ctx.unregisterReceiver(permissionReceiver);
            } catch (Throwable ignored) { }
            IntentFilter f = new IntentFilter(ACTION_USB_PERMISSION);
            if (Build.VERSION.SDK_INT >= 33) {
                ctx.registerReceiver(permissionReceiver, f, Context.RECEIVER_EXPORTED);
            } else {
                ctx.registerReceiver(permissionReceiver, f);
            }
            int flags = Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0;
            Intent intent = new Intent(ACTION_USB_PERMISSION);
            intent.setPackage(ctx.getPackageName());
            permissionIntent = PendingIntent.getBroadcast(ctx, 0, intent, flags);
            usbManager.requestPermission(dev, permissionIntent);
            latch.await(20, TimeUnit.SECONDS);
            return lastPermissionResult;
        } catch (Throwable t) {
            return null;
        } finally {
            lastPermissionResult = null;
        }
    }

    private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (!ACTION_USB_PERMISSION.equals(intent.getAction())) return;
            UsbDevice d = null;
            try {
                d = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            } catch (Throwable ignored) { }
            boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    && d != null;
            lastPermissionResult = granted;
        }
    };

    /** RX-Pump-Thread: Bulk-IN → Status-Bytes strippen → Ringpuffer. */
    private void startRx() {
        running.set(true);
        rxThread = new Thread(() -> {
            UsbSerialDriver drv = driver;
            byte[] buf = new byte[Math.max(64, drv != null ? drv.maxIn : 64)];
            while (running.get()) {
                int n;
                try {
                    n = drv.readChunk(buf, 50);
                } catch (Throwable t) {
                    n = -1;
                }
                if (!running.get()) break;
                if (n > 0) {
                    int off = 0, len = n;
                    if (drv.statusPrefix && len > 2) { off = 2; len -= 2; } // FTDI/CH340-Statusbytes
                    if (len > 0) {
                        synchronized (rxLock) {
                            for (int i = 0; i < len; i++) {
                                if (ringCount >= RX_RING_SIZE) {
                                    ringHead = (ringHead + 1) % RX_RING_SIZE; // drop-oldest
                                    ringCount--;
                                }
                                ring[(ringHead + ringCount) % RX_RING_SIZE] = buf[off + i];
                                ringCount++;
                            }
                            rxLock.notifyAll();
                        }
                    }
                }
                // n <= 0: Timeout oder Abzug → Schleife läuft weiter, bis close()
            }
        }, "QfSerialRx");
        rxThread.setDaemon(true);
        rxThread.start();
    }

    /** Schließt Treiber/Verbindung (ruft close() bzw. shutdown() immer unter stateLock). */
    private void closeLocked() {
        running.set(false);
        Thread t = rxThread;
        rxThread = null;
        if (t != null) {
            try { t.join(300); } catch (Throwable ignored) { }
        }
        if (driver != null) {
            try {
                conn.releaseInterface(driver.iface);
            } catch (Throwable ignored) { }
            driver = null;
        }
        if (conn != null) {
            try { conn.close(); } catch (Throwable ignored) { }
            conn = null;
        }
        device = null;
        synchronized (rxLock) {
            ringHead = 0;
            ringCount = 0;
        }
    }

    private static String err(String msg) {
        return "{\"ok\":false,\"error\":\"" + jsonEsc(msg) + "\"}";
    }

    private static String ok(String payload) {
        return "{\"ok\":true," + payload.substring(1);
    }

    private static String hex(int v) {
        String s = Integer.toHexString(v);
        while (s.length() < 4) s = "0" + s;
        return s;
    }

    private static String jsonEsc(String s) {
        if (s == null) return "";
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\') sb.append('\\').append(c);
            else if (c < 0x20) sb.append(' ');
            else sb.append(c);
        }
        return sb.toString();
    }
}
