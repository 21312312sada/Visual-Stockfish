# Xcorners model (LeYOLO)

Place the TensorFlow.js xcorners model here so the app can load it at `/480L_xcorners_float16/model.json`.

You need:
- `model.json`
- Weight file(s) (e.g. `group1-shard1of1.bin` or similar, as referenced in model.json)

**Where to get the model**

From [CameraChessWeb](https://github.com/Pbatch/CameraChessWeb):

1. **ONNX model**: [480L_leyolo_xcorners.onnx (Google Drive)](https://drive.google.com/file/d/1-2wodbiXag9UQ44e2AYAmoRN6jVpxy83/view?usp=sharing)
2. **Convert to TFJS**: Use their [TFJS export gist](https://gist.github.com/Pbatch/46d958df7e0363e42561bda50163a57a).

After conversion, copy the generated `model.json` and shard file(s) into this folder.
