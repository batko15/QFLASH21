package de.qflash21.app;

import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;

/**
 * QFLASH21 – FTDI FT232R/FT231X (VID 0403, PID 6001/6015).
 * SIO-Requests exakt wie ftdi_sio.c (Linux-Kernel) und wie die WebUSB-Portierung.
 */
final class FtdiDriver extends UsbSerialDriver {

    FtdiDriver(UsbDevice device, UsbDeviceConnection conn) {
        super(device, conn);
        this.statusPrefix = true; // 2 Status-Bytes pro Bulk-IN-Paket
    }

    @Override
    String init(int baud) {
        // SIO_RESET: SIO-Reset, dann RX/TX-Buffer purgen
        ctrlOut(0x00, 0x0000);
        ctrlOut(0x00, 0x0001);
        ctrlOut(0x00, 0x0002);
        // SIO_SET_FLOW_CTRL: none
        ctrlOut(0x02, 0x0000);
        // SIO_SET_BAUD_RATE
        String e = applyBaud(baud);
        if (e != null) return e;
        // SIO_SET_DATA: 8N1, BREAK aus
        ctrlOut(0x04, dataValue(false));
        // SIO_SET_LATENCY_TIMER: 1 ms (Diagnose-Latenz)
        ctrlOut(0x09, 0x0001);
        // DTR|RTS setzen (K+DCAN-Kabel erwarten oft aktive Handshake-Leitungen)
        ctrlOut(0x01, 0x0303);
        return null;
    }

    @Override
    String applyBaud(int baud) {
        if (baud < 300) return "Baudrate zu niedrig.";
        ctrlOut(0x03, ftdiBmDivisor(baud));
        return null;
    }

    @Override
    String setBreak(boolean on) {
        // SIO_SET_DATA mit Bit 14 = BREAK (ftdi_sio.c: FTDI_SIO_SET_DATA/SET_BREAK)
        int rc = ctrlOut(0x04, dataValue(on));
        return rc < 0 ? "FTDI-BREAK-Transfer fehlgeschlagen." : null;
    }

    private int dataValue(boolean breakOn) {
        final int bits = 8;
        final int parity = 0; // none
        final int stop = 0;   // 1 Stopbit
        final int brk = breakOn ? 0x4000 : 0x0000;
        return bits | (parity << 8) | (stop << 11) | brk;
    }
}
