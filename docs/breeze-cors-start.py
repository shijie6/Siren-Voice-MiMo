"""Breeze TTS 2 CORS 启动器（Siren Voice 扩展附带）

为什么需要它：
    官方 `python -m breeze_infer.api` 启动的服务没有 CORS 响应头，
    而酒馆页面（手机 SillyDroid / 电脑浏览器）与服务不同源（端口不同），
    浏览器会拦截跨源响应，导致 Siren Voice 无法调用。

它做什么：
    加载官方 breeze_infer.api 的 app，附加 CORSMiddleware（不修改官方任何文件），
    然后以与官方完全一致的参数启动。响应头中的 X-Sample-Rate 会被暴露给页面读取
    （Siren Voice 用它把 PCM 流封装成 WAV）。

用法（在 breeze-tts 推理仓库目录内，模型路径等参数与官方完全一致）：

    python /path/to/breeze-cors-start.py ../breeze-tts-2 --host 0.0.0.0 --port 7860

    # 可选的加速参数同样可用：
    python /path/to/breeze-cors-start.py ../breeze-tts-2 --host 0.0.0.0 --port 7860 --fast-all

启动后可以用浏览器或 curl 验证：curl http://127.0.0.1:7860/health
然后在 Siren Voice 的 Breeze TTS 设置里填入服务地址即可。
"""

import breeze_infer.api as breeze_api
from fastapi.middleware.cors import CORSMiddleware

# 必须在 uvicorn 启动前、app 首次响应前附加。
# expose_headers 必须包含 X-Sample-Rate，否则页面 JS 读不到采样率。
breeze_api.app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Sample-Rate"],
)

if __name__ == "__main__":
    breeze_api.main()
