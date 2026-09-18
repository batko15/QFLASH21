package de.qflash21.app;

import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;

/**
 * QFLASH21 – CP2102 (VID 10C4, PID EA60).
 * Requests exakt wie cp210x.c (Linux-Kernel) und die WebUSB-Portierung.
 */
final class Cp2102Driver extends UsbSerialDriver {

    Cp2102Driver(UsbDevice device, UsbDeviceConnection conn) {
        super(device, conn);
        this.statusPrefix = false; // CP2102 sendet reine Nutzdaten
    }

    @Override
    String init(int baud) {
        String e = applyBaud(baud);
        if (e != null) return e;
        // SET_LINE_CTL (0x03): 8 Datenbits, Parität none, 1 Stopbit → 0x0800
        ctrlOut(0x03, 0x0800);
        // SET_MHS (0x07): DTR|RTS setzen
        ctrlOut(0x07, 0x0303);
        // PURGE (0x12): RX + TX
        ctrlOut(0x12, 0x0003);
        return null;
    }

    @Override
    String applyBaud(int baud) {
        // SET_BAUDRATE (0x1E): u32 little-endian im Data-Stage
        byte[] b = new byte[4];
        b[0] = (byte) (baud & 0xFF);
        b[1] = (byte) ((baud >> 8) & 0xFF);
        b[2] = (byte) ((baud >> 16) & 0xFF);
        b[3] = (byte) ((baud >> 24) & 0xFF);
        int rc = ctrlOutData(0x1E, 0x0000, 0x0000, b);
        return rc < 0 ? "CP2102-Baud-Transfer fehlgeschlagen." : null;
    }

    @Override
    String setBreak(boolean on) {
        // CP210X_SET_BREAK (0x16): 1 = ON, 0 = OFF
        int rc = ctrlOut(0x16, on ? 0x0001 : 0x0000);
        return rc < 0 ? "CP2102-BREAK-Transfer fehlgeschlagen." : null;
    }
}
