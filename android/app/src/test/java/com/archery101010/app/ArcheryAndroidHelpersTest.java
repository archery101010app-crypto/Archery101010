package com.archery101010.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class ArcheryAndroidHelpersTest {

    @Test
    public void scorePointsFromLabel_handlesAllLabelsWithoutThrowing() {
        assertEquals(10, MainActivity.scorePointsFromLabel("X"));
        assertEquals(10, MainActivity.scorePointsFromLabel("x"));
        assertEquals(10, MainActivity.scorePointsFromLabel("10"));
        assertEquals(9, MainActivity.scorePointsFromLabel("9"));
        assertEquals(1, MainActivity.scorePointsFromLabel(" 1 "));
        assertEquals(0, MainActivity.scorePointsFromLabel("M"));
        assertEquals(0, MainActivity.scorePointsFromLabel("m"));
        assertEquals(0, MainActivity.scorePointsFromLabel(""));
        assertEquals(0, MainActivity.scorePointsFromLabel("-"));
        assertEquals(0, MainActivity.scorePointsFromLabel("—"));
        assertEquals(0, MainActivity.scorePointsFromLabel("invalid"));
        assertEquals(0, MainActivity.scorePointsFromLabel(null));
        assertEquals(10, MainActivity.scorePointsFromLabel("25"));
        assertEquals(0, MainActivity.scorePointsFromLabel("-5"));
    }

    @Test
    public void isTrustedOriginHost_blocksArbitraryGoogleSubdomains() {
        assertTrue(MainActivity.isTrustedOriginHost("localhost"));
        assertTrue(MainActivity.isTrustedOriginHost("127.0.0.1"));
        assertTrue(MainActivity.isTrustedOriginHost("archery101010-c0bb4.web.app"));
        assertTrue(MainActivity.isTrustedOriginHost("archery101010-c0bb4.firebaseapp.com"));
        assertTrue(MainActivity.isTrustedOriginHost("accounts.google.com"));

        assertFalse(MainActivity.isTrustedOriginHost("www.google.com"));
        assertFalse(MainActivity.isTrustedOriginHost("docs.google.com"));
        assertFalse(MainActivity.isTrustedOriginHost("drive.google.com"));
        assertFalse(MainActivity.isTrustedOriginHost("accounts.youtube.com"));
        assertFalse(MainActivity.isTrustedOriginHost("evil.googleusercontent.com"));
        assertFalse(MainActivity.isTrustedOriginHost("open.spotify.com"));
        assertFalse(MainActivity.isTrustedOriginHost(null));
    }

    @Test
    public void sanitizeExportFileName_stripsTraversalAndAppliesExtensions() {
        assertEquals("planilla.png", MainActivity.sanitizeExportFileName("../../planilla.png", ".png"));
        assertEquals("export_sesion.csv", MainActivity.sanitizeExportFileName("export sesion", ".csv"));
        assertEquals(".csv", MainActivity.extensionForMimeType("text/csv;charset=utf-8"));
        assertEquals(".png", MainActivity.extensionForMimeType("image/png"));
        assertEquals(".pdf", MainActivity.extensionForMimeType("application/pdf"));
        assertTrue(MainActivity.deriveExportFileName("data:text/csv;base64,AAA=", null, "text/csv").endsWith(".csv"));
    }
}
