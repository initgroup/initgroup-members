-- [ADMIN_PROJECT_COUNT]
SELECT COUNT(*) AS TOTAL_COUNT
  FROM "INIT$_TB_PROJECT" P
 WHERE 1=1
   AND (
        :periodYear IS NULL
        OR (
            P.PROJECT_START_DATE <= TO_DATE(TO_CHAR(:periodYear) || '1231', 'YYYYMMDD')
            AND P.PROJECT_END_DATE >= TO_DATE(TO_CHAR(:periodYear) || '0101', 'YYYYMMDD')
           )
       )
   AND (
        :periodYearFrom IS NULL
        OR P.PROJECT_END_DATE >= TO_DATE(TO_CHAR(:periodYearFrom) || '0101', 'YYYYMMDD')
       )
   AND (
        :periodYearTo IS NULL
        OR P.PROJECT_START_DATE <= TO_DATE(TO_CHAR(:periodYearTo) || '1231', 'YYYYMMDD')
       )
   AND (
        :keyword IS NULL
        OR UPPER(P.PROJECT_NAME) LIKE :keyword ESCAPE '\'
        OR UPPER(P.CUSTOMER_NAME) LIKE :keyword ESCAPE '\'
       )
   AND (:statusCode = 'ALL' OR P.STATUS_CODE = :statusCode)
   AND (
        :participationTypeCode = 'ALL'
        OR P.PARTICIPATION_TYPE_CODE = :participationTypeCode
       )
   AND (:periodStart IS NULL OR P.PROJECT_END_DATE >= :periodStart)
   AND (:periodEnd IS NULL OR P.PROJECT_START_DATE <= :periodEnd)
   AND (:bidDateFrom IS NULL OR P.BID_DATE >= :bidDateFrom)
   AND (:bidDateTo IS NULL OR P.BID_DATE <= :bidDateTo)
   AND (:contractAmountMin IS NULL OR P.CONTRACT_AMOUNT_VAT >= :contractAmountMin)
   AND (:contractAmountMax IS NULL OR P.CONTRACT_AMOUNT_VAT <= :contractAmountMax)
;

-- [ADMIN_PROJECT_LIST]
SELECT P.PROJECT_ID
     , P.PROJECT_YEAR
     , P.PROJECT_NAME
     , P.CUSTOMER_NAME
     , P.PROJECT_START_DATE
     , P.PROJECT_END_DATE
     , P.ORDER_AMOUNT_VAT
     , P.CONTRACT_AMOUNT_VAT
     , P.PARTICIPATION_TYPE_CODE
     , P.PARTICIPATION_RATE
     , P.ORDER_DATE
     , P.BID_DATE
     , P.STATUS_CODE
     , P.UPDATED_AT
  FROM "INIT$_TB_PROJECT" P
 WHERE 1=1
   AND (
        :periodYear IS NULL
        OR (
            P.PROJECT_START_DATE <= TO_DATE(TO_CHAR(:periodYear) || '1231', 'YYYYMMDD')
            AND P.PROJECT_END_DATE >= TO_DATE(TO_CHAR(:periodYear) || '0101', 'YYYYMMDD')
           )
       )
   AND (
        :periodYearFrom IS NULL
        OR P.PROJECT_END_DATE >= TO_DATE(TO_CHAR(:periodYearFrom) || '0101', 'YYYYMMDD')
       )
   AND (
        :periodYearTo IS NULL
        OR P.PROJECT_START_DATE <= TO_DATE(TO_CHAR(:periodYearTo) || '1231', 'YYYYMMDD')
       )
   AND (
        :keyword IS NULL
        OR UPPER(P.PROJECT_NAME) LIKE :keyword ESCAPE '\'
        OR UPPER(P.CUSTOMER_NAME) LIKE :keyword ESCAPE '\'
       )
   AND (:statusCode = 'ALL' OR P.STATUS_CODE = :statusCode)
   AND (
        :participationTypeCode = 'ALL'
        OR P.PARTICIPATION_TYPE_CODE = :participationTypeCode
       )
   AND (:periodStart IS NULL OR P.PROJECT_END_DATE >= :periodStart)
   AND (:periodEnd IS NULL OR P.PROJECT_START_DATE <= :periodEnd)
   AND (:bidDateFrom IS NULL OR P.BID_DATE >= :bidDateFrom)
   AND (:bidDateTo IS NULL OR P.BID_DATE <= :bidDateTo)
   AND (:contractAmountMin IS NULL OR P.CONTRACT_AMOUNT_VAT >= :contractAmountMin)
   AND (:contractAmountMax IS NULL OR P.CONTRACT_AMOUNT_VAT <= :contractAmountMax)
 ORDER BY CASE WHEN :sortBy = 'projectName' AND :sortDirection = 'asc'
               THEN P.PROJECT_NAME END ASC
        , CASE WHEN :sortBy = 'projectName' AND :sortDirection = 'desc'
               THEN P.PROJECT_NAME END DESC
        , CASE WHEN :sortBy = 'customerName' AND :sortDirection = 'asc'
               THEN P.CUSTOMER_NAME END ASC
        , CASE WHEN :sortBy = 'customerName' AND :sortDirection = 'desc'
               THEN P.CUSTOMER_NAME END DESC
        , CASE WHEN :sortBy = 'projectStartDate' AND :sortDirection = 'asc'
               THEN P.PROJECT_START_DATE END ASC
        , CASE WHEN :sortBy = 'projectStartDate' AND :sortDirection = 'desc'
               THEN P.PROJECT_START_DATE END DESC
        , CASE WHEN :sortBy = 'orderAmountVat' AND :sortDirection = 'asc'
               THEN P.ORDER_AMOUNT_VAT END ASC
        , CASE WHEN :sortBy = 'orderAmountVat' AND :sortDirection = 'desc'
               THEN P.ORDER_AMOUNT_VAT END DESC
        , CASE WHEN :sortBy = 'contractAmountVat' AND :sortDirection = 'asc'
               THEN P.CONTRACT_AMOUNT_VAT END ASC
        , CASE WHEN :sortBy = 'contractAmountVat' AND :sortDirection = 'desc'
               THEN P.CONTRACT_AMOUNT_VAT END DESC
        , CASE WHEN :sortBy = 'participationRate' AND :sortDirection = 'asc'
               THEN P.PARTICIPATION_RATE END ASC
        , CASE WHEN :sortBy = 'participationRate' AND :sortDirection = 'desc'
               THEN P.PARTICIPATION_RATE END DESC
        , CASE WHEN :sortBy = 'participationTypeCode' AND :sortDirection = 'asc'
               THEN P.PARTICIPATION_TYPE_CODE END ASC
        , CASE WHEN :sortBy = 'participationTypeCode' AND :sortDirection = 'desc'
               THEN P.PARTICIPATION_TYPE_CODE END DESC
        , CASE WHEN :sortBy = 'orderDate' AND :sortDirection = 'asc'
               THEN P.ORDER_DATE END ASC
        , CASE WHEN :sortBy = 'orderDate' AND :sortDirection = 'desc'
               THEN P.ORDER_DATE END DESC
        , CASE WHEN :sortBy = 'bidDate' AND :sortDirection = 'asc'
               THEN P.BID_DATE END ASC
        , CASE WHEN :sortBy = 'bidDate' AND :sortDirection = 'desc'
               THEN P.BID_DATE END DESC
        , CASE WHEN :sortBy = 'statusCode' AND :sortDirection = 'asc'
               THEN P.STATUS_CODE END ASC
        , CASE WHEN :sortBy = 'statusCode' AND :sortDirection = 'desc'
               THEN P.STATUS_CODE END DESC
        , P.PROJECT_ID DESC
 OFFSET :offset ROWS FETCH NEXT :pageSize ROWS ONLY
;

-- [ADMIN_PROJECT_DETAIL]
SELECT P.PROJECT_ID
     , P.PROJECT_YEAR
     , P.PROJECT_NAME
     , P.CUSTOMER_NAME
     , P.PROJECT_START_DATE
     , P.PROJECT_END_DATE
     , P.ORDER_AMOUNT_VAT
     , P.CONTRACT_AMOUNT_VAT
     , P.PARTICIPATION_TYPE_CODE
     , P.PARTICIPATION_RATE
     , P.ORDER_DATE
     , P.BID_DATE
     , P.STATUS_CODE
     , P.DESCRIPTION
     , P.CREATED_BY
     , CU.USER_NAME AS CREATED_BY_NAME
     , P.CREATED_AT
     , P.UPDATED_BY
     , UU.USER_NAME AS UPDATED_BY_NAME
     , P.UPDATED_AT
  FROM "INIT$_TB_PROJECT" P
  LEFT JOIN "INIT$_TB_USER" CU
    ON CU.USER_ID = P.CREATED_BY
  LEFT JOIN "INIT$_TB_USER" UU
    ON UU.USER_ID = P.UPDATED_BY
 WHERE P.PROJECT_ID = :projectId
;

-- [ADMIN_PROJECT_INSERT]
INSERT INTO "INIT$_TB_PROJECT" (
    PROJECT_YEAR
  , PROJECT_NAME
  , CUSTOMER_NAME
  , PROJECT_START_DATE
  , PROJECT_END_DATE
  , ORDER_AMOUNT_VAT
  , CONTRACT_AMOUNT_VAT
  , PARTICIPATION_TYPE_CODE
  , PARTICIPATION_RATE
  , ORDER_DATE
  , BID_DATE
  , STATUS_CODE
  , DESCRIPTION
  , CREATED_BY
  , CREATED_AT
) VALUES (
    :projectYear
  , :projectName
  , :customerName
  , :projectStartDate
  , :projectEndDate
  , :orderAmountVat
  , :contractAmountVat
  , :participationTypeCode
  , :participationRate
  , :orderDate
  , :bidDate
  , :statusCode
  , :description
  , :userId
  , SYSTIMESTAMP
)
RETURNING PROJECT_ID INTO :projectIdOut
;

-- [ADMIN_PROJECT_UPDATE]
UPDATE "INIT$_TB_PROJECT"
   SET PROJECT_YEAR = :projectYear
     , PROJECT_NAME = :projectName
     , CUSTOMER_NAME = :customerName
     , PROJECT_START_DATE = :projectStartDate
     , PROJECT_END_DATE = :projectEndDate
     , ORDER_AMOUNT_VAT = :orderAmountVat
     , CONTRACT_AMOUNT_VAT = :contractAmountVat
     , PARTICIPATION_TYPE_CODE = :participationTypeCode
     , PARTICIPATION_RATE = :participationRate
     , ORDER_DATE = :orderDate
     , BID_DATE = :bidDate
     , STATUS_CODE = :statusCode
     , DESCRIPTION = :description
     , UPDATED_BY = :userId
     , UPDATED_AT = SYSTIMESTAMP
 WHERE PROJECT_ID = :projectId
;

-- [ADMIN_PROJECT_DELETE]
DELETE
  FROM "INIT$_TB_PROJECT"
 WHERE PROJECT_ID = :projectId
;
