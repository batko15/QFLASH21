package de.qflash21.app;

import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;

/**
 * QFLASH21 – Basisklasse für native USB-Serial-Treiber (Android USB-Host-API).
 *
 * Subklassen: FtdiDriver (FT232R/FT231X), Ch340Driver (CH340/CH341), Cp2102Driver.
 * Baudraten-/BREAK-Mathematik identisch zu src/lib/kwp/webusb-serial.ts
 * (beide 1:1 aus dem Linux-Kernel portiert: ftdi_sio.c, ch341.c, cp210x.c).
 */
abstract class UsbSerialDriver {

    final UsbDevice device;
    final UsbDeviceConnection conn;
    UsbInterface iface = null;
    UsbEndpoint epIn = null;
    UsbEndpoint epOut = null;
    int maxIn = 64;
    /** true = jedes Bulk-IN-Paket beginnt mit 2 Status-Bytes (FTDI, CH340). */
    boolean statusPrefix = true;

    UsbSerialDriver(UsbDevice device, UsbDeviceConnection conn) {
        this.device = device;
        this.conn = conn;
    }

    /** Treiberkennung für VID/PID (null = nicht unterstützt). */
    static String kindFor(int vid, int pid) {
        if (vid == 0x0403 && (pid == 0x6001 || pid == 0x6015)) return "ftdi";
        if (vid == 0x1a86 && pid == 0x7523) return "ch340";
        if (vid == 0x10c4 && pid == 0xea60) return "cp2102";
        return null;
    }

    /** Fabrik: passenden Treiber erzeugen und Bulk-Endpunkte auflösen. */
    static UsbSerialDriver create(UsbDevice device, UsbDeviceConnection conn) {
        String kind = kindFor(device.getVendorId(), device.getProductId());
        if (kind == null) return null;
        UsbSerialDriver drv;
        if ("ftdi".equals(kind)) drv = new FtdiDriver(device, conn);
        else if ("ch340".equals(kind)) drv = new Ch340Driver(device, conn);
        else drv = new Cp2102Driver(device, conn);
        if (!drv.findEndpoints()) return null;
        return drv;
    }

    private boolean findEndpoints() {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface it = device.getInterface(i);
            UsbEndpoint in = null, out = null;
            for (int j = 0; j < it.getEndpointCount(); j++) {
                UsbEndpoint ep = it.getEndpoint(j);
                if (ep.getType() != UsbConstants.USB_ENDPOINT_XFER_BULK) continue;
                if (ep.getDirection() == UsbConstants.USB_DIR_IN && in == null) in = ep;
                else if (ep.getDirection() == UsbConstants.USB_DIR_OUT && out == null) out = ep;
            }
            if (in != null && out != null) {
                iface = it;
                epIn = in;
                epOut = out;
                maxIn = Math.max(32, in.getMaxPacketSize());
                return true;
            }
        }
        return false;
    }

    /** Öffnet das Interface und initialisiert den Chip. Rückgabe: null = OK, sonst Fehler. */
    final String open(int baud) {
        if (!conn.claimInterface(iface, true)) {
            return "USB-Interface konnte nicht beansprucht werden.";
        }
        return init(baud);
    }

    /** Chip-Grundkonfiguration nach claimInterface. Rückgabe: null = OK. */
    abstract String init(int baud);

    /** Baudrate setzen (nach init jederzeit möglich). Rückgabe: null = OK. */
    abstract String applyBaud(int baud);

    /** BREAK-Signal (K-Line-Low) setzen/entfernen. Rückgabe: null = OK. */
    abstract String setBreak(boolean on);

    /** Bulk-Read (nicht-blockierend bis timeoutMs). Rückgabe: Anzahl gelesener Bytes (≥ 0) oder -1 bei Fehler. */
    int readChunk(byte[] buf, int timeoutMs) {
        return conn.bulkTransfer(epIn, buf, buf.length, timeoutMs);
    }

    /** Bulk-Write. Rückgabe: Anzahl geschriebener Bytes oder -1. */
    int writeChunk(byte[] data, int len) {
        return conn.bulkTransfer(epOut, data, len, 3000);
    }

    String kind() {
        return kindFor(device.getVendorId(), device.getProductId());
    }

    /* ------------------- Vendor-Control-Transfer-Helper ------------------- */

    /** Vendor-OUT ohne Index (Index = 0). */
    int ctrlOut(int request, int value) {
        return ctrlOut(request, value, 0);
    }

    /** Vendor-OUT (bmRequestType 0x40, Recipient Device) – wie WebUSB requestType 'vendor'/'device'. */
    int ctrlOut(int request, int value, int index) {
        return conn.controlTransfer(0x40, request, value, index, null, 0, 500);
    }

    /** Vendor-OUT mit Daten-Stage (z. B. CP2102 SET_BAUDRATE). */
    int ctrlOutData(int request, int value, int index, byte[] data) {
        return conn.controlTransfer(0x40, request, value, index, data, data.length, 500);
    }

    /** Vendor-IN (bmRequestType 0xC0). Rückgabe: Anzahl gelesener Bytes oder -1. */
    int ctrlIn(int request, int value, int index, byte[] data) {
        return conn.controlTransfer(0xC0, request, value, index, data, data.length, 500);
    }

    /* ------------------- Treiber-Mathematik (Linux-Kernel 1:1) ------------------- */

    /** ftdi_sio.c: ftdi_232bm_baud_base_to_divisor (Base 48 MHz, divfrac {0,3,2,4,1,5,6,7}). */
    static int ftdiBmDivisor(int baud) {
        final int base = 48000000;
        final int[] divfrac = {0, 3, 2, 4, 1, 5, 6, 7};
        int divisor3 = Math.round(base / (2f * baud));
        if ((divisor3 & 0x7) == 0x7) divisor3++; // x.7/8 aufrunden
        int divisor = (divisor3 >> 3) | (divfrac[divisor3 & 0x7] << 14);
        if (divisor == 1) divisor = 0;             // höchste Baudrate
        else if (divisor == 0x4001) divisor = 1;
        return divisor;
    }

    /** ch341.c: ch341_get_divisor – Rückgabe: wIndex für WRITE_REG(0x9A), -1 = nicht unterstützt. */
    static int ch341Divisor(int baud) {
        final long CLKRATE = 48000000L;
        int speed = Math.min(Math.max(baud, 46), 3000000);
        // minRate(ps) = CLKRATE / (clkDiv(ps,1) * 512)
        long[] minRates = new long[4];
        for (int p = 0; p < 4; p++) {
            long clkDiv = 1L << (12 - 3 * p - 1);
            minRates[p] = CLKRATE / (clkDiv * 512L);
        }
        int ps = 3;
        for (; ps >= 0; ps--) {
            if (speed > minRates[ps]) break;
        }
        if (ps < 0) return -1;
        long clkDiv = 1L << (12 - 3L * ps - 1);
        long div = CLKRATE / (clkDiv * speed);
        int fact = 1;
        if (div < 9 || div > 255) {
            div = div / 2;
            fact = 0;
        }
        if (div < 2) return -1;
        if ((16L * CLKRATE) / (clkDiv * div) - 16L * speed
                >= 16L * speed - (16L * CLKRATE) / (clkDiv * (div + 1))) {
            div++;
        }
        if (fact == 1 && div % 2 == 0) {
            div /= 2;
            fact = 0;
        }
        return (int) (((0x100 - div) << 8) | (fact << 2) | ps);
    }
}
