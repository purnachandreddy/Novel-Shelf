package com.novelshelf.app

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import com.novelshelf.app.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding

    // ── File chooser (cover images + JSON restore) ──────────────────────────
    private var fileChooserCallback: ValueCallback<Array<Uri>>? = null

    private val filePickerLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val cb = fileChooserCallback ?: return@registerForActivityResult
        fileChooserCallback = null
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
        cb.onReceiveValue(uris)
    }

    // ── Export: CreateDocument picks the save location ───────────────────────
    // B1: volatile for safe multithreaded read/write
    @Volatile
    private var pendingExportData: String? = null

    // B2: distinguish cancel (uri == null) from write failure
    private val exportDocumentLauncher = registerForActivityResult(
        ActivityResultContracts.CreateDocument("*/*")
    ) { uri ->
        val data = pendingExportData ?: return@registerForActivityResult
        pendingExportData = null
        if (uri == null) {
            // User cancelled: success = false, cancelled = true
            binding.webView.evaluateJavascript(
                "window._onExportResult && window._onExportResult(false, true)",
                null
            )
            return@registerForActivityResult
        }
        try {
            contentResolver.openOutputStream(uri)?.use { it.write(data.toByteArray(Charsets.UTF_8)) }
            // Success: success = true, cancelled = false
            binding.webView.evaluateJavascript(
                "window._onExportResult && window._onExportResult(true, false)",
                null
            )
        } catch (e: Exception) {
            android.util.Log.e("NovelShelf", "Export write failed", e)
            // Error: success = false, cancelled = false
            binding.webView.evaluateJavascript(
                "window._onExportResult && window._onExportResult(false, false)",
                null
            )
        }
    }

    // ── @JavascriptInterface exposed to the web layer ─────────────────────────
    inner class AndroidBridge {
        /**
         * Called by JS to trigger the system file-save picker.
         * B1: launch must be executed on the UI thread.
         * JS must set window._onExportResult = function(success, cancelled){…} before calling this.
         */
        @JavascriptInterface
        fun saveJson(suggestedFilename: String, json: String) {
            runOnUiThread {
                pendingExportData = json
                exportDocumentLauncher.launch(suggestedFilename)
            }
        }

        @JavascriptInterface
        fun saveText(suggestedFilename: String, text: String) {
            runOnUiThread {
                pendingExportData = text
                exportDocumentLauncher.launch(suggestedFilename)
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Edge-to-edge display (notch, pill-nav, IME)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val insetsController = WindowCompat.getInsetsController(window, window.decorView)
        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = false

        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        window.statusBarColor = android.graphics.Color.TRANSPARENT
        window.navigationBarColor = android.graphics.Color.TRANSPARENT

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Fix #8 — include IME inset so keyboard doesn't cover the form
        ViewCompat.setOnApplyWindowInsetsListener(binding.root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val ime  = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            insets
        }

        // Back navigation: JS pushState handles modal/screen, canGoBack handles the rest
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (binding.webView.canGoBack()) {
                    binding.webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        setupWebView(binding.webView, assetLoader)
        binding.webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView(webView: WebView, assetLoader: WebViewAssetLoader) {
        webView.setLayerType(View.LAYER_TYPE_HARDWARE, null)
        webView.setBackgroundColor(android.graphics.Color.parseColor("#0B0E14"))

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        // allowFileAccess / allowContentAccess / mixedContent not needed: assets served via appassets
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true
        settings.setNeedInitialFocus(false)

        webView.isScrollbarFadingEnabled = true
        webView.overScrollMode = WebView.OVER_SCROLL_NEVER
        webView.isHapticFeedbackEnabled = true

        // Expose AndroidBridge so JS can call Android.saveJson(…)
        webView.addJavascriptInterface(AndroidBridge(), "Android")

        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }

            override fun shouldOverrideUrlLoading(
                view: WebView,
                request: WebResourceRequest
            ): Boolean {
                val scheme = request.url.scheme ?: ""
                val url = request.url.toString()
                // Block javascript: and non-http schemes
                if (scheme == "javascript") return true
                if (url.startsWith("https://appassets.androidplatform.net") ||
                    url.startsWith("file:///android_asset")) {
                    return false
                }
                if (scheme != "http" && scheme != "https") return true
                // B3: catch ActivityNotFoundException and don't navigate WebView
                return try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    true
                } catch (e: ActivityNotFoundException) {
                    true
                } catch (e: Exception) {
                    true
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                fileChooserCallback?.onReceiveValue(null)
                fileChooserCallback = filePathCallback

                val intent = fileChooserParams?.createIntent()
                    ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                    }

                return try {
                    filePickerLauncher.launch(Intent.createChooser(intent, "Choose File"))
                    true
                } catch (e: Exception) {
                    fileChooserCallback?.onReceiveValue(null)
                    fileChooserCallback = null
                    false
                }
            }

            // B5: Log console messages only in DEBUG builds
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                if (BuildConfig.DEBUG) {
                    consoleMessage?.let {
                        android.util.Log.d(
                            "NovelShelf.JS",
                            "[${it.messageLevel()}] ${it.message()} (${it.sourceId()}:${it.lineNumber()})"
                        )
                    }
                }
                return true
            }
        }
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onPause() {
        binding.webView.onPause()
        super.onPause()
    }

    // B4: remove WebView from parent layout before destroying to prevent leaks
    override fun onDestroy() {
        (binding.webView.parent as? ViewGroup)?.removeView(binding.webView)
        binding.webView.stopLoading()
        binding.webView.destroy()
        super.onDestroy()
    }
}