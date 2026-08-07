"""
Quantize an ONNX model to INT4 using ONNX Runtime's MatMulNBitsQuantizer.

Usage:
    python quantize.py
"""

import os
from onnxruntime.quantization.matmul_nbits_quantizer import MatMulNBitsQuantizer

INPUT_ONNX = "/home/jemin/Projects/acm-extension/memoneg-270m.onnx"
OUTPUT_INT4_ONNX = "/home/jemin/Projects/acm-extension/memoneg-270m-int4.onnx"


def quantize_int4(input_path: str, output_path: str):
    print(f"Loading {input_path} for INT4 quantization...")
    quantizer = MatMulNBitsQuantizer(
        model=input_path,
        bits=4,
        block_size=128,
        is_symmetric=True,
    )
    print("Processing weights (4-bit MatMul quantization)...")
    quantizer.process()
    quantizer.model.save_model_to_file(output_path)
    print(f"INT4 ONNX exported → {output_path}")
    print(f"File size: {os.path.getsize(output_path) / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    quantize_int4(INPUT_ONNX, OUTPUT_INT4_ONNX)
