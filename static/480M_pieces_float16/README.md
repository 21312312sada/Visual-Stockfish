# Pieces model (LeYOLO)

Place the TensorFlow.js pieces model here so the app can load it at `/480M_pieces_float16/model.json`.

You need:
- `model.json`
- Weight file(s) (e.g. `group1-shard1of1.bin` or similar, as referenced in model.json)

**Where to get the model**

From [CameraChessWeb](https://github.com/Pbatch/CameraChessWeb):

1. **ONNX model**: [480M_leyolo_pieces.onnx (Google Drive)](https://drive.google.com/file/d/1-80xp_nly9i6s3o0mF0mU9OZGEzUAlGj/view?usp=sharing)
2. **Convert to TFJS**: Use their [TFJS export gist](https://gist.github.com/Pbatch/46d958df7e0363e42561bda50163a57a) or the [Colab training + ONNX export gist](https://gist.github.com/Pbatch/dccc680ac2f852d4f258e4b6f1997a7b).

After conversion, copy the generated `model.json` and shard file(s) into this folder.
