from __future__ import annotations

import unittest
from io import BytesIO

from fastapi import HTTPException
from PIL import Image

from backend.routers import admin_users


class AdminUserPhotoValidationTests(unittest.TestCase):
    def test_photo_type_is_detected_from_file_signature(self):
        samples = {
            "image/jpeg": b"\xff\xd8\xff\xe0\x00\x10JFIF",
            "image/png": b"\x89PNG\r\n\x1a\n\x00\x00",
            "image/gif": b"GIF89a\x00\x00",
            "image/webp": b"RIFF\x04\x00\x00\x00WEBPVP8 ",
        }

        for expected_type, file_data in samples.items():
            with self.subTest(expected_type=expected_type):
                self.assertEqual(expected_type, admin_users._validated_photo_type(file_data))

    def test_jpeg_with_png_filename_content_type_is_stored_as_jpeg(self):
        file_data = b"\xff\xd8\xff\xe0\x00\x10JFIF"

        self.assertEqual("image/jpeg", admin_users._validated_photo_type(file_data))

    def test_invalid_or_incomplete_image_signature_is_rejected(self):
        for file_data in (b"not-an-image", b"RIFF\x04\x00\x00\x00NOPE"):
            with self.subTest(file_data=file_data):
                with self.assertRaises(HTTPException) as context:
                    admin_users._validated_photo_type(file_data)

                self.assertEqual(400, context.exception.status_code)

    def test_photo_thumbnail_is_small_fixed_size_jpeg(self):
        source = BytesIO()
        Image.new("RGB", (1200, 800), "#234f72").save(
            source,
            format="PNG",
        )

        thumbnail = admin_users._build_photo_thumbnail(source.getvalue())

        self.assertLess(len(thumbnail), len(source.getvalue()))
        with Image.open(BytesIO(thumbnail)) as image:
            self.assertEqual("JPEG", image.format)
            self.assertEqual((160, 160), image.size)

    def test_uploaded_photo_is_resized_and_stored_as_jpeg(self):
        source = BytesIO()
        Image.new("RGBA", (2400, 1600), (35, 79, 114, 180)).save(
            source,
            format="PNG",
        )

        normalized, content_type = admin_users._normalized_profile_photo(
            source.getvalue()
        )

        self.assertEqual("image/jpeg", content_type)
        self.assertLess(len(normalized), len(source.getvalue()))
        with Image.open(BytesIO(normalized)) as image:
            self.assertEqual("JPEG", image.format)
            self.assertLessEqual(image.width, 1200)
            self.assertLessEqual(image.height, 1200)

    def test_normalized_photo_name_uses_jpeg_extension(self):
        self.assertEqual(
            "employee.profile.jpg",
            admin_users._normalized_photo_name("employee.profile.png"),
        )


if __name__ == "__main__":
    unittest.main()
