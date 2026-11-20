// Модели и рантайм для «оживления» фото лежат на нашем же сайте — без сторонних CDN
import { mkdirSync, copyFileSync } from 'node:fs';
mkdirSync('public/ml', { recursive: true });
copyFileSync('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'public/ml/ort-wasm-simd-threaded.wasm');
copyFileSync('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'public/ml/ort-wasm-simd-threaded.mjs');
copyFileSync('node_modules/@rmbg/model-u2netp/u2netp.onnx', 'public/ml/u2netp.onnx');
copyFileSync('models/fastdepth.onnx', 'public/ml/fastdepth.onnx');
copyFileSync('models/migan.onnx', 'public/ml/migan.onnx');
console.log('ml assets copied');
