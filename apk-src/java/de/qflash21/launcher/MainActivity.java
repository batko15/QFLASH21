package de.qflash21.launcher;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.ShapeDrawable;
import android.graphics.drawable.shapes.OvalShape;
import android.net.Uri;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

/**
 * QFLASH21-Launcher: öffnet die QFLASH21-PWA in Chrome.
 *
 * Bewusst KEIN WebView/TWA: Web Serial (nötig für K-Line-Adapter) funktioniert
 * zuverlässig nur im echten Chrome – hier wird Chrome mit der App-URL gestartet.
 */
public class MainActivity extends Activity {

    private static final String APP_URL = "https://qflashk.vercel.app/";
    private static final String CHROME_PKG = "com.android.chrome";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildUi());
        // Direkt beim Start öffnen (Button als Fallback / Rückkehr)
        openApp();
    }

    private View buildUi() {
        int pad = dp(24);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setBackgroundColor(Color.parseColor("#09090b"));
        root.setPadding(pad, pad, pad, pad);

        ImageView icon = new ImageView(this);
        icon.setImageResource(getIdentifier("ic_launcher", "mipmap"));
        icon.getLayoutParams();
        LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(112), dp(112));
        ip.bottomMargin = dp(20);
        icon.setLayoutParams(ip);
        root.addView(icon);

        TextView title = new TextView(this);
        title.setText("QFLASH21");
        title.setTextColor(Color.parseColor("#fafafa"));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 34);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setGravity(Gravity.CENTER);
        root.addView(title);

        TextView subtitle = new TextView(this);
        subtitle.setText("DDE4-Diagnose & Flash · BMW E38/E39/E46/E53");
        subtitle.setTextColor(Color.parseColor("#a1a1aa"));
        subtitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        subtitle.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams sp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        sp.topMargin = dp(6);
        sp.bottomMargin = dp(36);
        subtitle.setLayoutParams(sp);
        root.addView(subtitle);

        Button open = new Button(this);
        open.setText("APP ÖFFNEN");
        open.setTextColor(Color.parseColor("#18181b"));
        open.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        open.setTypeface(Typeface.DEFAULT_BOLD);
        open.setAllCaps(false);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.parseColor("#f59e0b"));
        bg.setCornerRadius(dp(28));
        open.setBackground(bg);
        open.setPadding(dp(48), dp(14), dp(48), dp(14));
        open.setOnClickListener(v -> openApp());
        root.addView(open);

        TextView hint = new TextView(this);
        hint.setText("Wird in Chrome geöffnet (Web Serial ab Chrome 138).\nOTG-Adapter + K+DCAN-Kabel anschließen, Zündung Stellung 2.");
        hint.setTextColor(Color.parseColor("#71717a"));
        hint.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        hint.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams hp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        hp.topMargin = dp(28);
        hint.setLayoutParams(hp);
        root.addView(hint);

        return root;
    }

    private void openApp() {
        Uri uri = Uri.parse(APP_URL);
        Intent chrome = new Intent(Intent.ACTION_VIEW, uri);
        chrome.setPackage(CHROME_PKG);
        chrome.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(chrome);
            return;
        } catch (Exception ignored) {
            // Chrome nicht installiert → beliebigen Browser versuchen
        }
        Intent any = new Intent(Intent.ACTION_VIEW, uri);
        any.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        try {
            startActivity(any);
        } catch (Exception e) {
            Toast.makeText(this, "Kein Browser gefunden – bitte Chrome installieren.", Toast.LENGTH_LONG).show();
        }
    }

    private int getIdentifier(String name, String defType) {
        return getResources().getIdentifier(name, defType, getPackageName());
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(
                TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
