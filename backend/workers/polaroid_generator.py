#!/var/www/apimain/multiplatformpublic/venv/bin/python3
"""
Polaroid Generator — creates Polaroid 600 photos on 10×15 sheets.

Uses MediaPipe FaceLandmarker for smart vertical cropping:
- Fits by width (preserves horizontal framing)
- Shifts vertically to keep the head uncut
- Falls back to top-aligned crop when no face is detected

Template: real Polaroid 600 (88×107mm, 79×79mm square photo)
Sheet: 10×15 cm (1200×1800px at 300 DPI)
Cut lines: right edge + bottom edge

Input (stdin JSON):
  {
    "image_url": "https://...",      # OR
    "image_path": "/tmp/photo.jpg",  # local file
    "output_path": "/tmp/out.jpg",   # where to save result
    "face_data": {                   # optional pre-computed face data
      "forehead_y": 120,
      "chin_y": 450,
      "image_width": 1120,
      "image_height": 1280
    }
  }

Output (stdout JSON):
  {
    "success": true,
    "result": {
      "output_path": "/tmp/out.jpg",
      "face_detected": true,
      "crop_top": 42,
      "width": 1200,
      "height": 1800
    }
  }
"""

import sys
import json
import os
import time
import signal
import io

TIMEOUT_SECONDS = 60
DPI = 300

# Polaroid 600 real dimensions (mm → px at 300 DPI)
def mm2px(mm):
    return int(mm / 25.4 * DPI)

SHEET_W, SHEET_H = 1200, 1800  # 10×15 cm
CARD_W = mm2px(88)     # 1039
CARD_H = mm2px(107)    # 1263
BORDER_TOP = mm2px(5)      # 59
BORDER_SIDE = mm2px(4.5)   # 53
BORDER_BOTTOM = mm2px(23)  # 272
PHOTO_SIZE = mm2px(79)     # 933 (square)

# MediaPipe landmark indices
LM_FOREHEAD = 10
LM_CHIN = 152

LINE_COLOR = (200, 200, 200)


def log(msg):
    print(f'[PolaroidGen] {msg}', file=sys.stderr, flush=True)


def download_image(url):
    """Download image from URL, return bytes."""
    import httpx
    with httpx.Client(timeout=15.0, follow_redirects=True) as client:
        resp = client.get(url)
        resp.raise_for_status()
        return resp.content


def detect_face(img):
    """Run MediaPipe FaceLandmarker, return (forehead_y, chin_y) or None."""
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    import numpy as np

    w, h = img.size
    np_image = np.array(img)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np_image)

    model_candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), 'face_landmarker.task'),
        os.path.expanduser('~/.mediapipe/face_landmarker.task'),
        '/tmp/face_landmarker.task',
    ]
    model_path = next((p for p in model_candidates if os.path.exists(p)), None)
    if not model_path:
        log('FaceLandmarker model not found')
        return None

    base_options = mp_python.BaseOptions(model_asset_path=model_path)
    options = vision.FaceLandmarkerOptions(
        base_options=base_options,
        num_faces=5,
    )

    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        result = landmarker.detect(mp_image)

    if not result.face_landmarks:
        return None

    # Pick largest face
    best = max(result.face_landmarks,
               key=lambda lm: abs(lm[LM_CHIN].y - lm[LM_FOREHEAD].y))

    forehead_y = int(best[LM_FOREHEAD].y * h)
    chin_y = int(best[LM_CHIN].y * h)
    return forehead_y, chin_y


def generate_polaroid(img, face_data=None):
    """
    Generate Polaroid on 10×15 sheet.
    Returns (canvas, face_detected, crop_top).
    """
    from PIL import Image, ImageDraw

    w, h = img.size
    side = w  # Fit by width
    face_detected = False
    crop_top = 0
    crop_left = 0

    if h <= w:
        # Landscape: fit by height, center horizontally
        side = h
        crop_top = 0
        crop_left = (w - side) // 2
    else:
        # Portrait: full width, shift vertically
        extra = h - side

        if face_data and face_data.get('forehead_y') is not None:
            forehead_y = face_data['forehead_y']
            chin_y = face_data['chin_y']
            face_detected = True
        else:
            result = detect_face(img)
            if result:
                forehead_y, chin_y = result
                face_detected = True
                face_data = {'forehead_y': forehead_y, 'chin_y': chin_y}

        if face_detected:
            face_h = abs(chin_y - forehead_y)
            # Keep 30% face height above forehead + 5% sheet padding
            head_top = forehead_y - int(face_h * 0.3)
            desired_top = max(0, head_top - int(side * 0.05))
            crop_top = max(0, min(extra, desired_top))
        else:
            # No face — crop from top (keep head, lose feet)
            crop_top = 0

    cropped = img.crop((crop_left, crop_top, crop_left + side, crop_top + side))
    cropped = cropped.resize((PHOTO_SIZE, PHOTO_SIZE), Image.LANCZOS)

    # White canvas (10×15 sheet), Polaroid in top-left corner
    canvas = Image.new('RGB', (SHEET_W, SHEET_H), (255, 255, 255))
    canvas.paste(cropped, (BORDER_SIDE, BORDER_TOP))

    # Cut lines: right edge and bottom edge
    draw = ImageDraw.Draw(canvas)
    draw.line([(CARD_W, 0), (CARD_W, SHEET_H)], fill=LINE_COLOR, width=1)
    draw.line([(0, CARD_H), (SHEET_W, CARD_H)], fill=LINE_COLOR, width=1)

    return canvas, face_detected, crop_top


def main():
    from PIL import Image

    # HEIC support
    try:
        from pillow_heif import register_heif_opener
        register_heif_opener()
    except ImportError:
        pass

    start = time.time()
    input_data = json.loads(sys.stdin.read())

    image_url = input_data.get('image_url', '')
    image_path = input_data.get('image_path', '')
    output_path = input_data.get('output_path', '')
    face_data = input_data.get('face_data')

    if not image_url and not image_path:
        raise ValueError('image_url or image_path is required')
    if not output_path:
        raise ValueError('output_path is required')

    # Load image
    if image_path:
        log(f'Reading local file: {image_path}')
        img = Image.open(image_path).convert('RGB')
    else:
        log(f'Downloading: {image_url[:80]}...')
        image_bytes = download_image(image_url)
        img = Image.open(io.BytesIO(image_bytes)).convert('RGB')

    log(f'Image: {img.size[0]}x{img.size[1]}')

    canvas, face_detected, crop_top = generate_polaroid(img, face_data)
    canvas.save(output_path, 'JPEG', quality=95, dpi=(DPI, DPI))

    elapsed = round((time.time() - start) * 1000)
    log(f'Done: face={face_detected}, crop_top={crop_top}, {elapsed}ms')

    result = {
        'output_path': output_path,
        'face_detected': face_detected,
        'crop_top': crop_top,
        'width': SHEET_W,
        'height': SHEET_H,
        'processing_time_ms': elapsed,
    }
    json.dump({'success': True, 'result': result}, sys.stdout, ensure_ascii=False)


if __name__ == '__main__':
    signal.signal(signal.SIGALRM, lambda s, f: (_ for _ in ()).throw(TimeoutError('Worker timeout')))
    signal.alarm(TIMEOUT_SECONDS)

    try:
        main()
    except Exception as e:
        log(f'ERROR: {e}')
        json.dump({'success': False, 'error': str(e)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
