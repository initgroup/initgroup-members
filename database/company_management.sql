-- [COMPANY_LIST_BY_TYPE]
SELECT COMPANY_ID
     , COMPANY_TYPE_CODE
     , COMPANY_NAME
     , BUSINESS_NUMBER
     , REPRESENTATIVE_NAME
     , BUSINESS_TYPE
     , BUSINESS_ITEM
     , EMAIL
     , PHONE
     , ADDRESS
     , WEBSITE_URL
     , ESTABLISHED_DATE
     , USE_YN
     , NOTE
     , CREATED_AT
     , UPDATED_AT
  FROM "INIT$_TB_COMPANY"
 WHERE 1=1
   AND COMPANY_TYPE_CODE = :companyTypeCode
 ORDER BY USE_YN DESC
        , COMPANY_NAME
        , COMPANY_ID
;

-- [COMPANY_INSERT]
INSERT INTO "INIT$_TB_COMPANY" (
    COMPANY_TYPE_CODE
  , COMPANY_NAME
  , BUSINESS_NUMBER
  , REPRESENTATIVE_NAME
  , BUSINESS_TYPE
  , BUSINESS_ITEM
  , EMAIL
  , PHONE
  , ADDRESS
  , WEBSITE_URL
  , ESTABLISHED_DATE
  , USE_YN
  , NOTE
  , CREATED_BY
  , CREATED_AT
) VALUES (
    :companyTypeCode
  , :companyName
  , :businessNumber
  , :representativeName
  , :businessType
  , :businessItem
  , :email
  , :phone
  , :address
  , :websiteUrl
  , :establishedDate
  , :useYn
  , :note
  , :userId
  , SYSTIMESTAMP
)
RETURNING COMPANY_ID INTO :companyIdOut
;

-- [COMPANY_UPDATE]
UPDATE "INIT$_TB_COMPANY"
   SET COMPANY_NAME = :companyName
     , BUSINESS_NUMBER = :businessNumber
     , REPRESENTATIVE_NAME = :representativeName
     , BUSINESS_TYPE = :businessType
     , BUSINESS_ITEM = :businessItem
     , EMAIL = :email
     , PHONE = :phone
     , ADDRESS = :address
     , WEBSITE_URL = :websiteUrl
     , ESTABLISHED_DATE = :establishedDate
     , USE_YN = :useYn
     , NOTE = :note
     , UPDATED_BY = :userId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE 1=1
   AND COMPANY_ID = :companyId
   AND COMPANY_TYPE_CODE = :companyTypeCode
;

-- [COMPANY_DELETE]
DELETE FROM "INIT$_TB_COMPANY"
 WHERE 1=1
   AND COMPANY_ID = :companyId
   AND COMPANY_TYPE_CODE = :companyTypeCode
;

-- [COMPANY_EXISTS_TYPE]
SELECT COUNT(*)
  FROM "INIT$_TB_COMPANY"
 WHERE 1=1
   AND COMPANY_ID = :companyId
   AND COMPANY_TYPE_CODE = :companyTypeCode
;

-- [COMPANY_EMPLOYEE_LIST]
SELECT E.COMPANY_EMPLOYEE_ID
     , E.COMPANY_ID
     , C.COMPANY_TYPE_CODE
     , C.COMPANY_NAME
     , E.EMPLOYEE_NO
     , E.EMPLOYEE_NAME
     , E.DEPARTMENT_NAME
     , E.POSITION_NAME
     , E.JOB_TITLE
     , E.EMAIL
     , E.MOBILE_PHONE
     , E.JOIN_DATE
     , E.LEAVE_DATE
     , E.USE_YN
     , E.NOTE
     , E.CREATED_AT
     , E.UPDATED_AT
     , E.GENDER_CODE
     , E.AGE_YEARS
     , E.TECHNICAL_GRADE_CODE
     , E.CAREER_MONTHS
  FROM "INIT$_TB_COMPANY_EMPLOYEE" E
  JOIN "INIT$_TB_COMPANY" C
    ON C.COMPANY_ID = E.COMPANY_ID
 WHERE 1=1
   AND E.COMPANY_ID = :companyId
   AND C.COMPANY_TYPE_CODE = :companyTypeCode
 ORDER BY E.USE_YN DESC
        , E.EMPLOYEE_NAME
        , E.COMPANY_EMPLOYEE_ID
;

-- [COMPANY_EMPLOYEE_INSERT]
INSERT INTO "INIT$_TB_COMPANY_EMPLOYEE" (
    COMPANY_ID
  , EMPLOYEE_NO
  , EMPLOYEE_NAME
  , DEPARTMENT_NAME
  , POSITION_NAME
  , JOB_TITLE
  , EMAIL
  , MOBILE_PHONE
  , JOIN_DATE
  , LEAVE_DATE
  , USE_YN
  , NOTE
  , GENDER_CODE
  , AGE_YEARS
  , TECHNICAL_GRADE_CODE
  , CAREER_MONTHS
  , CREATED_BY
  , CREATED_AT
)
VALUES (
    :companyId
  , :employeeNo
  , :employeeName
  , :departmentName
  , :positionName
  , :jobTitle
  , :email
  , :mobilePhone
  , :joinDate
  , :leaveDate
  , :useYn
  , :note
  , :genderCode
  , :ageYears
  , :technicalGradeCode
  , :careerMonths
  , :userId
  , SYSTIMESTAMP
)
RETURNING COMPANY_EMPLOYEE_ID INTO :companyEmployeeIdOut
;

-- [COMPANY_EMPLOYEE_UPDATE]
UPDATE "INIT$_TB_COMPANY_EMPLOYEE" E
   SET EMPLOYEE_NO = :employeeNo
     , EMPLOYEE_NAME = :employeeName
     , DEPARTMENT_NAME = :departmentName
     , POSITION_NAME = :positionName
     , JOB_TITLE = :jobTitle
     , EMAIL = :email
     , MOBILE_PHONE = :mobilePhone
     , JOIN_DATE = :joinDate
     , LEAVE_DATE = :leaveDate
     , USE_YN = :useYn
     , NOTE = :note
     , GENDER_CODE = :genderCode
     , AGE_YEARS = :ageYears
     , TECHNICAL_GRADE_CODE = :technicalGradeCode
     , CAREER_MONTHS = :careerMonths
     , UPDATED_BY = :userId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE 1=1
   AND E.COMPANY_EMPLOYEE_ID = :companyEmployeeId
   AND E.COMPANY_ID = :companyId
   AND EXISTS (
        SELECT 1
          FROM "INIT$_TB_COMPANY" C
         WHERE C.COMPANY_ID = E.COMPANY_ID
           AND C.COMPANY_TYPE_CODE = :companyTypeCode
       )
;

-- [COMPANY_EMPLOYEE_DELETE]
DELETE FROM "INIT$_TB_COMPANY_EMPLOYEE" E
 WHERE 1=1
   AND E.COMPANY_EMPLOYEE_ID = :companyEmployeeId
   AND E.COMPANY_ID = :companyId
   AND EXISTS (
        SELECT 1
          FROM "INIT$_TB_COMPANY" C
         WHERE C.COMPANY_ID = E.COMPANY_ID
           AND C.COMPANY_TYPE_CODE = :companyTypeCode
       )
;

-- [COMPANY_HISTORY_LIST]
SELECT H.COMPANY_HISTORY_ID
     , H.COMPANY_ID
     , H.HISTORY_DATE
     , H.HISTORY_TYPE_CODE
     , H.TITLE
     , H.CONTENT
     , H.CREATED_AT
     , H.UPDATED_AT
  FROM "INIT$_TB_COMPANY_HISTORY" H
  JOIN "INIT$_TB_COMPANY" C
    ON C.COMPANY_ID = H.COMPANY_ID
 WHERE 1=1
   AND H.COMPANY_ID = :companyId
   AND C.COMPANY_TYPE_CODE = 'HEADQUARTERS'
 ORDER BY H.HISTORY_DATE DESC
        , H.COMPANY_HISTORY_ID DESC
;

-- [COMPANY_HISTORY_INSERT]
INSERT INTO "INIT$_TB_COMPANY_HISTORY" (
    COMPANY_ID
  , HISTORY_DATE
  , HISTORY_TYPE_CODE
  , TITLE
  , CONTENT
  , CREATED_BY
  , CREATED_AT
)
VALUES (
    :companyId
  , :historyDate
  , :historyTypeCode
  , :title
  , :content
  , :userId
  , SYSTIMESTAMP
)
RETURNING COMPANY_HISTORY_ID INTO :companyHistoryIdOut
;

-- [COMPANY_HISTORY_UPDATE]
UPDATE "INIT$_TB_COMPANY_HISTORY" H
   SET HISTORY_DATE = :historyDate
     , HISTORY_TYPE_CODE = :historyTypeCode
     , TITLE = :title
     , CONTENT = :content
     , UPDATED_BY = :userId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE 1=1
   AND H.COMPANY_HISTORY_ID = :companyHistoryId
   AND H.COMPANY_ID = :companyId
   AND EXISTS (
        SELECT 1
          FROM "INIT$_TB_COMPANY" C
         WHERE C.COMPANY_ID = H.COMPANY_ID
           AND C.COMPANY_TYPE_CODE = 'HEADQUARTERS'
       )
;

-- [COMPANY_HISTORY_DELETE]
DELETE FROM "INIT$_TB_COMPANY_HISTORY" H
 WHERE 1=1
   AND H.COMPANY_HISTORY_ID = :companyHistoryId
   AND H.COMPANY_ID = :companyId
   AND EXISTS (
        SELECT 1
          FROM "INIT$_TB_COMPANY" C
         WHERE C.COMPANY_ID = H.COMPANY_ID
           AND C.COMPANY_TYPE_CODE = 'HEADQUARTERS'
       )
;
