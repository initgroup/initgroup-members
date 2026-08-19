-- [ADMIN_USER_COUNT]
SELECT COUNT(*) AS TOTAL_COUNT
  FROM "INIT$_TB_USER"
 WHERE 1=1
   AND (
        :keyword IS NULL
        OR UPPER(LOGIN_ID) LIKE :keyword
        OR UPPER(USER_NAME) LIKE :keyword
        OR UPPER(EMAIL) LIKE :keyword
        OR UPPER(EMPLOYEE_NO) LIKE :keyword
        OR UPPER(DEPARTMENT_NAME) LIKE :keyword
        OR UPPER(POSITION_NAME) LIKE :keyword
        OR UPPER(JOB_TITLE) LIKE :keyword
       )
   AND (:useYn = 'ALL' OR USE_YN = :useYn)
;

-- [ADMIN_USER_LIST]
SELECT USER_ID
     , LOGIN_ID
     , USER_NAME
     , EMAIL
     , ROLE_CODE
     , USE_YN
     , CREATED_AT
     , UPDATED_AT
     , PASSWORD_CHANGE_YN
     , EMPLOYEE_NO
     , GENDER_CODE
     , BIRTH_DATE
     , BIRTH_CALENDAR_CODE
     , HIRE_DATE
     , RETIREMENT_DATE
     , EMPLOYMENT_STATUS_CODE
     , EMPLOYMENT_TYPE_CODE
     , DEPARTMENT_NAME
     , POSITION_NAME
     , JOB_TITLE
     , WORK_LOCATION
     , MOBILE_PHONE
     , OFFICE_PHONE
     , HR_NOTE
     , PHOTO_FILE_NAME
     , PHOTO_CONTENT_TYPE
     , PHOTO_FILE_SIZE
     , PHOTO_UPDATED_AT
     , TECHNICAL_GRADE_CODE
     , CAREER_MONTHS
  FROM "INIT$_TB_USER"
 WHERE 1=1
   AND (
        :keyword IS NULL
        OR UPPER(LOGIN_ID) LIKE :keyword
        OR UPPER(USER_NAME) LIKE :keyword
        OR UPPER(EMAIL) LIKE :keyword
        OR UPPER(EMPLOYEE_NO) LIKE :keyword
        OR UPPER(DEPARTMENT_NAME) LIKE :keyword
        OR UPPER(POSITION_NAME) LIKE :keyword
        OR UPPER(JOB_TITLE) LIKE :keyword
       )
   AND (:useYn = 'ALL' OR USE_YN = :useYn)
 ORDER BY EMPLOYEE_NO ASC NULLS LAST
        , USER_NAME ASC
        , USER_ID ASC
 OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
;

-- [ADMIN_USER_UPDATE]
UPDATE "INIT$_TB_USER"
   SET LOGIN_ID = :loginId
     , USER_NAME = :userName
     , EMAIL = :email
     , ROLE_CODE = :roleCode
     , USE_YN = :useYn
     , EMPLOYEE_NO = :employeeNo
     , GENDER_CODE = :genderCode
     , BIRTH_DATE = :birthDate
     , BIRTH_CALENDAR_CODE = :birthCalendarCode
     , HIRE_DATE = :hireDate
     , RETIREMENT_DATE = :retirementDate
     , EMPLOYMENT_STATUS_CODE = :employmentStatusCode
     , EMPLOYMENT_TYPE_CODE = :employmentTypeCode
     , DEPARTMENT_NAME = :departmentName
     , POSITION_NAME = :positionName
     , JOB_TITLE = :jobTitle
     , WORK_LOCATION = :workLocation
     , MOBILE_PHONE = :mobilePhone
     , OFFICE_PHONE = :officePhone
     , HR_NOTE = :hrNote
     , TECHNICAL_GRADE_CODE = :technicalGradeCode
     , CAREER_MONTHS = :careerMonths
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_CREATE_DUPLICATE_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId
    OR LOWER(EMAIL) = LOWER(:email)
    OR (:employeeNo IS NOT NULL AND EMPLOYEE_NO = :employeeNo)
;

-- [ADMIN_USER_INSERT]
INSERT INTO "INIT$_TB_USER" (
    LOGIN_ID
  , USER_NAME
  , EMAIL
  , PASSWORD_HASH
  , ROLE_CODE
  , USE_YN
  , PASSWORD_CHANGE_YN
  , EMPLOYEE_NO
  , GENDER_CODE
  , BIRTH_DATE
  , BIRTH_CALENDAR_CODE
  , HIRE_DATE
  , RETIREMENT_DATE
  , EMPLOYMENT_STATUS_CODE
  , EMPLOYMENT_TYPE_CODE
  , DEPARTMENT_NAME
  , POSITION_NAME
  , JOB_TITLE
  , WORK_LOCATION
  , MOBILE_PHONE
  , OFFICE_PHONE
  , HR_NOTE
  , TECHNICAL_GRADE_CODE
  , CAREER_MONTHS
  , CREATED_AT
) VALUES (
    :loginId
  , :userName
  , :email
  , :passwordHash
  , :roleCode
  , :useYn
  , 'N'
  , :employeeNo
  , :genderCode
  , :birthDate
  , :birthCalendarCode
  , :hireDate
  , :retirementDate
  , :employmentStatusCode
  , :employmentTypeCode
  , :departmentName
  , :positionName
  , :jobTitle
  , :workLocation
  , :mobilePhone
  , :officePhone
  , :hrNote
  , :technicalGradeCode
  , :careerMonths
  , SYSTIMESTAMP
)
;

-- [ADMIN_USER_ID_BY_LOGIN]
SELECT USER_ID
  FROM "INIT$_TB_USER"
 WHERE LOGIN_ID = :loginId
;

-- [ADMIN_USER_DUPLICATE_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE USER_ID <> :userId
   AND (
       LOGIN_ID = :loginId
       OR LOWER(EMAIL) = LOWER(:email)
       OR (:employeeNo IS NOT NULL AND EMPLOYEE_NO = :employeeNo)
       )
;

-- [ADMIN_USER_TABLE_LOCK]
LOCK TABLE "INIT$_TB_USER" IN EXCLUSIVE MODE
;

-- [ADMIN_USER_ROLE_STATUS]
SELECT ROLE_CODE
     , USE_YN
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_ACTIVE_ADMIN_COUNT]
SELECT COUNT(*)
  FROM "INIT$_TB_USER"
 WHERE ROLE_CODE = 'ADMIN'
   AND USE_YN = 'Y'
;

-- [ADMIN_USER_PASSWORD_RESET]
UPDATE "INIT$_TB_USER"
   SET PASSWORD_HASH = :passwordHash
     , PASSWORD_CHANGE_YN = 'N'
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_IDENTITY]
SELECT LOGIN_ID
     , USER_NAME
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_SESSION_REVOKE]
UPDATE "INIT$_TB_AUTH_SESSION"
   SET REVOKED_AT = LOCALTIMESTAMP
 WHERE USER_ID = :userId
   AND REVOKED_AT IS NULL
;

-- [ADMIN_USER_DELETE]
DELETE FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_PHOTO_UPDATE]
UPDATE "INIT$_TB_USER"
   SET PHOTO_FILE_NAME = :photoFileName
     , PHOTO_CONTENT_TYPE = :photoContentType
     , PHOTO_FILE_SIZE = :photoFileSize
     , PHOTO_DATA = :photoData
     , PHOTO_UPDATED_AT = SYSTIMESTAMP
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
;

-- [ADMIN_USER_PHOTO_DOWNLOAD]
SELECT PHOTO_CONTENT_TYPE
     , PHOTO_DATA
  FROM "INIT$_TB_USER"
 WHERE USER_ID = :userId
   AND PHOTO_DATA IS NOT NULL
;

-- [ADMIN_USER_PHOTO_DELETE]
UPDATE "INIT$_TB_USER"
   SET PHOTO_FILE_NAME = NULL
     , PHOTO_CONTENT_TYPE = NULL
     , PHOTO_FILE_SIZE = NULL
     , PHOTO_DATA = NULL
     , PHOTO_UPDATED_AT = NULL
     , UPDATED_AT = SYSTIMESTAMP
 WHERE USER_ID = :userId
   AND PHOTO_DATA IS NOT NULL
;
