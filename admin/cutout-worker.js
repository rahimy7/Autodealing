// Runs the background-removal model off the main thread. ormbg is Apache-2.0, so a commercial
// dealership can use it, unlike the RMBG family, whose licence excludes commercial use.
// The server gives this file its own CSP (see CUTOUT_WORKER_CSP): it can't reach the site's API.
import { cleanMask } from './mask-cleanup.js';

const LIBRARY = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/transformers.min.js';
const MODEL = 'onnx-community/ormbg-ONNX';
const REVISION = '034e2d884afbab897e10e78fc5bb566b29533fd6';

// Imported on demand, not statically: static imports of a worker are fetched under the page's
// stricter CSP. It also can't be a top-level await, because messages sent meanwhile would be lost.
let library;
const transformers = () => (library ||= import(LIBRARY).then((module) => {
  module.env.allowLocalModels = false;
  module.env.useWasmCache = false; // Its cache loads the runtime from a blob: URL, which the CSP forbids.
  return module;
}));

const sessions = new Map();
function session(device) {
  if (!sessions.has(device))
    sessions.set(device, transformers().then(({ AutoModel, AutoProcessor }) => Promise.all([
      AutoModel.from_pretrained(MODEL, {
        revision: REVISION,
        dtype: 'fp16',
        device,
        progress_callback: (event) => {
          if (event.status === 'progress' && event.file?.endsWith('.onnx'))
            postMessage({ type: 'download', ratio: event.progress / 100 });
        },
      }),
      AutoProcessor.from_pretrained(MODEL, { revision: REVISION }),
    ])).catch((error) => { sessions.delete(device); throw error; }));
  return sessions.get(device);
}

async function predict(device, image) {
  const [model, processor] = await session(device);
  const { RawImage } = await transformers();
  postMessage({ type: 'working' });
  const { pixel_values } = await processor(image);
  const { alphas } = await model({ pixel_values });
  const scaled = await RawImage.fromTensor(alphas[0].mul(255).to('uint8')).resize(image.width, image.height);
  return scaled.data;
}

async function hasGpu() {
  try { return Boolean(await navigator.gpu?.requestAdapter()); } catch { return false; }
}

// A GPU can be present and still fail on this model, so it always falls back to the CPU.
async function alphaFor(image) {
  if (await hasGpu()) {
    try { return await predict('webgpu', image); } catch (error) { console.warn('WebGPU failed, using CPU.', error); }
  }
  return predict('wasm', image);
}

onmessage = async ({ data: { id, photo } }) => {
  try {
    const { RawImage } = await transformers();
    const image = await RawImage.fromBlob(photo);
    const mask = cleanMask(await alphaFor(image), image.width, image.height);
    if (!mask) return postMessage({ type: 'error', id, code: 'no-subject' });
    postMessage({ type: 'done', id, mask, width: image.width, height: image.height }, [mask.buffer]);
  } catch (error) {
    console.error(error);
    postMessage({ type: 'error', id, code: 'failed' });
  }
};
