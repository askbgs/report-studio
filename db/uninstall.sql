--------------------------------------------------------------------------------
-- Report Studio - remove all objects (DATA IS LOST)
--------------------------------------------------------------------------------
drop package rpt_api;
drop package rpt_designer;
drop package rpt_util;
drop table rpt_log purge;
drop table rpt_versions purge;
drop table rpt_sources purge;
drop table rpt_reports purge;
drop table rpt_assets purge;
drop table rpt_config purge;
