package com.smartcommunity.portal;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends android.app.Activity {
    private static final int FILE_CHOOSER_REQUEST = 100;
    private static final int WEB_PERMISSION_REQUEST = 101;

    private WebView webView;
    private ValueCallback<Uri[]> fileChooserCallback;
    private PermissionRequest pendingWebPermission;
    private String[] pendingAndroidPermissions;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        webView = new WebView(this);
        setContentView(webView);

        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new PortalChromeClient());
        webView.setDownloadListener(new PortalDownloadListener());

        if (savedInstanceState == null) {
            webView.loadUrl(BuildConfig.WEB_APP_URL);
        } else {
            webView.restoreState(savedInstanceState);
        }

    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_CHOOSER_REQUEST || fileChooserCallback == null) return;
        fileChooserCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
        fileChooserCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != WEB_PERMISSION_REQUEST || pendingWebPermission == null) return;

        boolean granted = true;
        for (int result : grantResults) granted &= result == PackageManager.PERMISSION_GRANTED;
        if (granted) pendingWebPermission.grant(pendingWebPermission.getResources());
        else pendingWebPermission.deny();
        pendingWebPermission = null;
        pendingAndroidPermissions = null;
    }

    @Override
    protected void onDestroy() {
        if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
        if (pendingWebPermission != null) pendingWebPermission.deny();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private final class PortalChromeClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileChooserCallback != null) fileChooserCallback.onReceiveValue(null);
            fileChooserCallback = callback;
            try {
                startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                return true;
            } catch (RuntimeException exception) {
                fileChooserCallback = null;
                callback.onReceiveValue(null);
                return false;
            }
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            runOnUiThread(() -> grantWebPermission(request));
        }
    }

    private void grantWebPermission(PermissionRequest request) {
        String appHost = Uri.parse(BuildConfig.WEB_APP_URL).getHost();
        if (appHost == null || !appHost.equals(request.getOrigin().getHost())) {
            request.deny();
            return;
        }

        List<String> missingPermissions = new ArrayList<>();
        for (String resource : request.getResources()) {
            if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(Manifest.permission.CAMERA);
            } else if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                missingPermissions.add(Manifest.permission.RECORD_AUDIO);
            }
        }

        if (missingPermissions.isEmpty()) {
            request.grant(request.getResources());
            return;
        }

        pendingWebPermission = request;
        pendingAndroidPermissions = missingPermissions.toArray(new String[0]);
        requestPermissions(pendingAndroidPermissions, WEB_PERMISSION_REQUEST);
    }

    private final class PortalDownloadListener implements DownloadListener {
        @Override
        public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimeType, long contentLength) {
            try {
                String filename = url.toLowerCase().contains(".apk") ? "community-portal.apk" : "community-download";
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                        .setTitle(filename)
                        .setDescription("Downloading from Community Portal")
                        .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                        .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);
                request.setMimeType(url.toLowerCase().contains(".apk")
                        ? "application/vnd.android.package-archive"
                        : (mimeType == null ? "application/octet-stream" : mimeType));
                request.addRequestHeader("User-Agent", userAgent);
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(MainActivity.this, "Download started", Toast.LENGTH_SHORT).show();
            } catch (RuntimeException exception) {
                Toast.makeText(MainActivity.this, "Download could not be started", Toast.LENGTH_LONG).show();
            }
        }
    }
}
