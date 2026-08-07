const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const libDir = path.join(projectRoot, 'src', 'lib');

if (!fs.existsSync(libDir)) {
  fs.mkdirSync(libDir, { recursive: true });
}

function copyFile(src, dest) {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`[copy-libs] Copied ${path.basename(src)} -> src/lib/`);
  } else {
    console.warn(`[copy-libs] Source file not found: ${src}`);
  }
}

// 1. Copy ONNX Runtime Web JS
copyFile(
  path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist', 'ort.all.min.js'),
  path.join(libDir, 'ort.all.min.js')
);

// 2. Copy Hugging Face Transformers JS
copyFile(
  path.join(projectRoot, 'node_modules', '@huggingface', 'transformers', 'dist', 'transformers.min.js'),
  path.join(libDir, 'transformers.min.js')
);

// 3. Copy WASM binaries from onnxruntime-web
const onnxDist = path.join(projectRoot, 'node_modules', 'onnxruntime-web', 'dist');
if (fs.existsSync(onnxDist)) {
  const files = fs.readdirSync(onnxDist);
  files.forEach((file) => {
    if (file.endsWith('.wasm')) {
      copyFile(path.join(onnxDist, file), path.join(libDir, file));
    }
  });
}

console.log('[copy-libs] Finished preparing src/lib/');
