from __future__ import annotations

import unittest

from fastapi import HTTPException
from pydantic import ValidationError

from backend.database_helper import SqlLoader
from backend.department_config import departments, enrich_department
from backend.department_config import departments, enrich_department
from backend.routers import admin_companies, admin_users


class WorkforceProfileFieldTests(unittest.TestCase):
    def test_department_config_has_unique_ordered_entries(self):
        items = departments()

        self.assertEqual(5, len(items))
        self.assertEqual([10, 20, 30, 40, 50], [item["displayOrder"] for item in items])
        self.assertEqual("경영전략지원부", items[0]["label"])
        self.assertEqual(len(items), len({item["code"] for item in items}))

    def test_department_code_is_saved_with_configured_label(self):
        payload = admin_users.EmployeeProfileRequest(departmentCode="APP_DEVELOPMENT")

        params = admin_users._profile_values(payload)

        self.assertEqual("APP_DEVELOPMENT", params["departmentCode"])
        self.assertEqual("APP개발사업부", params["departmentName"])
        enriched = enrich_department({"departmentCode": "APP_DEVELOPMENT", "departmentName": "이전 라벨"})
        self.assertEqual("APP개발사업부", enriched["departmentName"])
        self.assertEqual(30, enriched["departmentDisplayOrder"])

    def test_unsupported_department_code_is_rejected(self):
        payload = admin_users.EmployeeProfileRequest(departmentCode="UNKNOWN")

        with self.assertRaises(HTTPException) as context:
            admin_users._profile_values(payload)

        self.assertEqual(400, context.exception.status_code)

    def test_department_config_has_unique_ordered_entries(self):
        items = departments()

        self.assertEqual(5, len(items))
        self.assertEqual([10, 20, 30, 40, 50], [item["displayOrder"] for item in items])
        self.assertEqual(len(items), len({item["code"] for item in items}))

    def test_department_code_is_saved_with_configured_label(self):
        payload = admin_users.EmployeeProfileRequest(departmentCode="APP_DEVELOPMENT")

        params = admin_users._profile_values(payload)

        self.assertEqual("APP_DEVELOPMENT", params["departmentCode"])
        self.assertEqual("APP개발사업부", params["departmentName"])
        enriched = enrich_department({"departmentCode": "APP_DEVELOPMENT", "departmentName": "이전 라벨"})
        self.assertEqual("APP개발사업부", enriched["departmentName"])
        self.assertEqual(30, enriched["departmentDisplayOrder"])

    def test_unsupported_department_code_is_rejected(self):
        payload = admin_users.EmployeeProfileRequest(departmentCode="UNKNOWN")

        with self.assertRaises(HTTPException) as context:
            admin_users._profile_values(payload)

        self.assertEqual(400, context.exception.status_code)

    def test_admin_user_grade_and_career_months_are_normalized(self):
        payload = admin_users.EmployeeProfileRequest(
            technicalGradeCode="advanced",
            careerMonths=84,
        )

        params = admin_users._profile_values(payload)

        self.assertEqual("ADVANCED", params["technicalGradeCode"])
        self.assertEqual(84, params["careerMonths"])

    def test_partner_employee_fields_are_normalized(self):
        payload = admin_companies.EmployeeWriteRequest(
            employeeName="홍길동",
            genderCode="female",
            ageYears=35,
            technicalGradeCode="special",
            careerMonths=120,
        )

        params = admin_companies._employee_params(payload, 7)

        self.assertEqual("FEMALE", params["genderCode"])
        self.assertEqual(35, params["ageYears"])
        self.assertEqual("SPECIAL", params["technicalGradeCode"])
        self.assertEqual(120, params["careerMonths"])

    def test_unsupported_grade_is_rejected(self):
        payload = admin_users.EmployeeProfileRequest(technicalGradeCode="EXPERT")

        with self.assertRaises(HTTPException) as context:
            admin_users._profile_values(payload)

        self.assertEqual(400, context.exception.status_code)

    def test_numeric_limits_are_rejected_before_database_access(self):
        with self.assertRaises(ValidationError):
            admin_companies.EmployeeWriteRequest(employeeName="홍길동", ageYears=151)
        with self.assertRaises(ValidationError):
            admin_users.EmployeeProfileRequest(careerMonths=1201)

    def test_new_dml_bind_contracts_include_profile_fields(self):
        expected = {"technicalgradecode", "careermonths"}
        self.assertTrue(expected.issubset(SqlLoader.bind_names("ADMIN_USER_INSERT")))
        self.assertTrue(expected.issubset(SqlLoader.bind_names("ADMIN_USER_UPDATE")))
        partner_expected = expected | {"gendercode", "ageyears"}
        self.assertTrue(partner_expected.issubset(SqlLoader.bind_names("COMPANY_EMPLOYEE_INSERT")))
        self.assertTrue(partner_expected.issubset(SqlLoader.bind_names("COMPANY_EMPLOYEE_UPDATE")))


if __name__ == "__main__":
    unittest.main()
