package com.trilinii.game;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.webkit.WebView;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

// Полноэкранный режим: скрываем строку состояния и навигацию,
// они появляются по свайпу от края и снова прячутся.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        hideSystemBars();
        clearCacheAfterUpdate();
    }

    // После обновления приложения чистим кэш встроенного браузера,
    // чтобы игра точно загрузилась из нового APK, а не из старого кэша.
    private void clearCacheAfterUpdate() {
        try {
            PackageInfo info = getPackageManager().getPackageInfo(getPackageName(), 0);
            String ver = String.valueOf(info.versionCode);
            SharedPreferences prefs = getSharedPreferences("arena", MODE_PRIVATE);
            if (ver.equals(prefs.getString("webCacheVer", ""))) return;
            WebView wv = getBridge().getWebView();
            wv.clearCache(true);
            prefs.edit().putString("webCacheVer", ver).apply();
            wv.reload();
        } catch (Exception e) {
            // не получилось — не страшно, игра просто запустится как обычно
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        c.hide(WindowInsetsCompat.Type.systemBars());
        c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
    }
}
