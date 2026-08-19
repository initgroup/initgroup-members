from __future__ import annotations

import unittest

from fastapi import HTTPException
from pydantic import ValidationError

from backend.database_helper import SqlLoader
from backend.routers import admin_companies, admin_users


class WorkforceProfileFieldTests(unittest.TestCase):
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
