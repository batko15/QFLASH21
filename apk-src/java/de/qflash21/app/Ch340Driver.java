package de.qflash21.app;

import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;

/**
 * QFLASH21 – CH340/CH341 (VID 1A86, PID 7523) – häufig in K+DCAN-Klon-Kabeln.
 * Requests/Register exakt wie ch341.c (Linux-Kernel) und die WebUSB-Portierung.
 */
final class Ch340Driver extends UsbSerialDriver {

    private int version = 0x30;

    Ch340Driver(UsbDevice device, UsbDeviceConnection conn) {
        super(device, conn);
        this.statusPrefix = true; // 2 Status-Bytes pro Bulk-IN-Paket
    }

    @Override
    String init(int baud) {
        // Chip-Version lesen (CH341_REQ_READ_VERSION 0x5F)
        byte[] ver = new byte[2];
        int n = ctrlIn(0x5F, 0x0000, 0, ver);
        if (n > 0) version = ver[0] & 0xFF;
        // SERIAL_INIT (0xA1)
        ctrlOut(0xA1, 0x0000);
        // Baudrate: WRITE_REG(0x9A), wValue=(REG_DIVISOR<<8)|REG_PRESCALER = 0x1312
        String e = applyBaud(baud);
        if (e != null) return e;
        // LCR (ab Version 0x30): wValue=(REG_LCR2<<8)|REG_LCR = 0x2518
        if (version >= 0x30) {
            ctrlOut(0x9A, 0x2518, lcr());
        }
        // DTR|RTS an (invertierte Logik: ~control) – CH341_REQ_WRITE_REG_CTRL 0xA4
        ctrlOut(0xA4, (~0x60) & 0xFFFF);
        return null;
    }

    @Override
    String applyBaud(int baud) {
        int val = ch341Divisor(baud);
        if (val < 0) return "CH340: Baudrate " + baud + " nicht unterstützt.";
        if (version > 0x27) val |= 0x80; // Full-packet-Buffering aus (ch341.c ab v2.8)
        ctrlOut(0x9A, 0x1312, val);
        return null;
    }

    @Override
    String setBreak(boolean on) {
        // ch341_break_ctl: Register 0x05 (BREAK) + 0x18 (LCR) lesen → ändern → schreiben
        byte[] regs = new byte[2];
        int n = ctrlIn(0x95, 0x1805, 0, regs);
        int breakReg = n > 0 ? (regs[0] & 0xFF) : 0x01;
        int lcr = n > 1 ? (regs[1] & 0xFF) : lcr();
        if (on) {
            breakReg &= ~0x01;   // CH341_NBREAK_BITS aus
            lcr &= ~0x40;        // ENABLE_TX aus → TX auf Space (K-Line LOW)
        } else {
            breakReg |= 0x01;
            lcr |= 0x40;
        }
        int rc = ctrlOut(0x9A, 0x1805, (breakReg & 0xFF) | ((lcr & 0xFF) << 8));
        return rc < 0 ? "CH340-BREAK-Transfer fehlgeschlagen." : null;
    }

    /** LCR: RX|TX enable, 8 Datenbits, Parität none (ch341.c-Layout). */
    private int lcr() {
        final int RX = 0x80, TX = 0x40, PAR_EN = 0x08, PAR_EVEN = 0x10, CS8 = 0x03;
        return RX | TX | CS8 | PAR_EN | 0; // even → | PAR_EVEN (KWP läuft 8N1)
    }
}
