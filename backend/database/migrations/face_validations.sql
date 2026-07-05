-- Face validation results (MediaPipe FaceLandmarker)
-- Stores face geometry measurements for passport/document photo validation

CREATE TABLE IF NOT EXISTS face_validations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Link to source (one of two)
  photo_approval_id UUID REFERENCES photo_approvals(id) ON DELETE CASCADE,
  message_id UUID,

  -- Source image
  image_url TEXT NOT NULL,
  image_dpi INT,
  dpi_source VARCHAR(20),  -- 'exif', 'override', 'default'

  -- MediaPipe results
  face_detected BOOLEAN NOT NULL DEFAULT false,
  face_count INT DEFAULT 0,
  face_height_px INT,
  face_height_mm NUMERIC(5,1),
  face_width_px INT,
  face_width_mm NUMERIC(5,1),
  forehead_y INT,
  chin_y INT,
  eye_level_delta_px INT,
  landmarks_count INT,

  -- Verdict
  is_valid_passport BOOLEAN,
  is_valid_greencard BOOLEAN,
  verdict VARCHAR(20) DEFAULT 'unknown',
  verdict_details JSONB DEFAULT '{}',

  -- Meta
  validated_by UUID REFERENCES users(id),
  processing_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_face_validations_photo
  ON face_validations(photo_approval_id) WHERE photo_approval_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_face_validations_message
  ON face_validations(message_id) WHERE message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_face_validations_created
  ON face_validations(created_at DESC);
