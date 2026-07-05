-- Fix media_attachments where Office documents were stored as application/zip
-- Root cause: .docx/.xlsx/.pptx are ZIP containers, magic-bytes detector
-- returned application/zip instead of the specific Office MIME type.

UPDATE media_attachments
SET mime_type = CASE
  WHEN file_name ILIKE '%.docx' THEN 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  WHEN file_name ILIKE '%.xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  WHEN file_name ILIKE '%.pptx' THEN 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  WHEN file_name ILIKE '%.odt'  THEN 'application/vnd.oasis.opendocument.text'
  WHEN file_name ILIKE '%.ods'  THEN 'application/vnd.oasis.opendocument.spreadsheet'
  WHEN file_name ILIKE '%.odp'  THEN 'application/vnd.oasis.opendocument.presentation'
END
WHERE mime_type = 'application/zip'
  AND (file_name ILIKE '%.docx'
    OR file_name ILIKE '%.xlsx'
    OR file_name ILIKE '%.pptx'
    OR file_name ILIKE '%.odt'
    OR file_name ILIKE '%.ods'
    OR file_name ILIKE '%.odp');
