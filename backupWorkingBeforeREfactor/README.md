# WebGPU Minimal (Vanilla JS)

سه فایل ساده که در تمام مرورگرهای دارای WebGPU (مثل Chrome 113+) کار می‌کند.

## اجرا

یک سرور استاتیک ساده بالا بیاور:

- Python: `python -m http.server 8000`
- Node (serve): `npx serve .`

بعد برو به: `http://localhost:8000/`

ساختار:

```
index.html
src/
  main.js
  gpu/
    gpuRenderer.js
```
