# Модели

- `fastdepth.onnx` — FastDepth (Wofk et al., MIT): оценка глубины по одному кадру, вход 224×224. Взята из пакета `com.bonjour-lab.monoculardepth` (MIT, см. `fastdepth.LICENSE`).
- U²-Netp (Apache-2.0) ставится из npm-пакета `@rmbg/model-u2netp`.

При сборке `scripts/copy-ml.mjs` кладёт модели и рантайм onnxruntime-web в `public/ml/`.
