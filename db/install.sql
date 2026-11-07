--------------------------------------------------------------------------------
-- Report Studio for Oracle APEX - install (run as the workspace parsing schema)
--   SQL*Plus / SQLcl:  @install.sql
--   APEX SQL Workshop: upload and run each numbered script in order
--------------------------------------------------------------------------------
set define off
set serveroutput on
whenever sqlerror continue

prompt == Tables
@@01_tables.sql
prompt == RPT_UTIL
@@02_rpt_util.sql
prompt == RPT_DESIGNER
@@03_rpt_designer.sql
prompt == RPT_API
@@04_rpt_api.sql
prompt == Sample reports (INVOICE, STOCK_LIST) and LOGO image
@@05_samples.sql

prompt == Object status
select object_name, object_type, status
  from user_objects
 where object_name like 'RPT\_%' escape '\'
 order by object_type, object_name;

select name, type, line, position, text
  from user_errors
 where name like 'RPT\_%' escape '\'
 order by name, type, sequence;
