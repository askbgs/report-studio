--------------------------------------------------------------------------------
-- Report Studio - RPT_API : public API used by applications
--
--   l_pdf := rpt_api.get_pdf('INVOICE', '{"INVOICE_NO":"INV-2026-0042"}');
--   rpt_api.download('INVOICE');                 -- binds read from APEX session state
--   rpt_api.get_payload('INVOICE')               -- layout + data JSON (browser printing)
--
-- APEX Application Process (Ajax Callback) "RPT_RUN":   rpt_api.ajax;
--   x01 = PAYLOAD | PDF, x02 = report code, x03 = 'Y' to use test parameters,
--   p_clob_01 = JSON object of parameters (optional; page items submitted with
--   the request are used automatically for :BINDS)
--------------------------------------------------------------------------------
create or replace package rpt_api as

  function get_payload(p_code   in varchar2,
                       p_params in clob    default null,
                       p_test   in boolean default false) return clob;

  function get_pdf(p_code   in varchar2,
                   p_params in clob    default null,
                   p_test   in boolean default false) return blob;

  procedure download(p_code     in varchar2,
                     p_params   in clob     default null,
                     p_filename in varchar2 default null,
                     p_inline   in boolean  default true,
                     p_test     in boolean  default false);

  procedure ajax;

end rpt_api;
/

create or replace package body rpt_api as

  procedure log_run(p_code in varchar2, p_type in varchar2, p_params in clob, p_bytes in number,
                    p_start in timestamp, p_status in varchar2, p_error in varchar2) is
    pragma autonomous_transaction;
  begin
    insert into rpt_log (report_code, output_type, params, bytes, duration_ms, status, error_message)
    values (p_code, p_type, p_params, p_bytes,
            round((extract(second from (systimestamp - p_start))
                 + extract(minute from (systimestamp - p_start)) * 60
                 + extract(hour   from (systimestamp - p_start)) * 3600) * 1000),
            p_status, substr(p_error, 1, 4000));
    commit;
  exception
    when others then rollback;
  end log_run;

  ------------------------------------------------------------------------------
  function get_payload(p_code   in varchar2,
                       p_params in clob    default null,
                       p_test   in boolean default false) return clob is
    l_id      number;
    l_name    rpt_reports.name%type;
    l_layout  clob;
    l_status  rpt_reports.status%type;
    l_params  json_object_t;
    l_data    json_object_t;
    l_payload json_object_t := json_object_t();
    l_max     pls_integer;
  begin
    begin
      select report_id, name, layout, status into l_id, l_name, l_layout, l_status
        from rpt_reports where code = upper(p_code);
    exception
      when no_data_found then raise_application_error(-20120, 'Report ' || p_code || ' does not exist');
    end;
    if l_status = 'ARCHIVED' and not p_test then
      raise_application_error(-20121, 'Report ' || p_code || ' is archived');
    end if;
    if p_params is not null and dbms_lob.getlength(p_params) > 0 then
      l_params := json_object_t.parse(p_params);
    end if;
    l_max := case when p_test then to_number(rpt_util.cfg('PREVIEW_MAX_ROWS', '500'))
                  else to_number(rpt_util.cfg('MAX_ROWS', '100000')) end;
    l_data := rpt_util.build_data(l_id, l_params, p_test, l_max);
    l_data.put('assets', rpt_util.assets_for_layout(l_layout));
    l_payload.put('code', upper(p_code));
    l_payload.put('name', l_name);
    l_payload.put('layout', json_object_t.parse(l_layout));
    l_payload.put('data', l_data);
    return l_payload.to_clob;
  end get_payload;

  ------------------------------------------------------------------------------
  function get_pdf(p_code   in varchar2,
                   p_params in clob    default null,
                   p_test   in boolean default false) return blob is
    l_start   timestamp := systimestamp;
    l_payload clob;
    l_pdf     blob;
    l_err     varchar2(4000);
    l_url     varchar2(4000) := rpt_util.cfg('RENDER_URL');
    l_body    blob;
    l_dest    integer := 1;
    l_src     integer := 1;
    l_lang    integer := dbms_lob.default_lang_ctx;
    l_warn    integer;
  begin
    if l_url is null then
      raise_application_error(-20122, 'RPT_CONFIG.RENDER_URL is not set');
    end if;
    l_payload := get_payload(p_code, p_params, p_test);

    -- Send the JSON as UTF-8 bytes: a CLOB body can be truncated when it contains
    -- multi-byte characters (Tamil, Sinhala, ·), which the server then rejects as invalid JSON.
    dbms_lob.createtemporary(l_body, true);
    dbms_lob.converttoblob(dest_lob     => l_body,
                           src_clob     => l_payload,
                           amount       => dbms_lob.lobmaxsize,
                           dest_offset  => l_dest,
                           src_offset   => l_src,
                           blob_csid    => nls_charset_id('AL32UTF8'),
                           lang_context => l_lang,
                           warning      => l_warn);

    apex_web_service.clear_request_headers;
    apex_web_service.set_request_headers(
      p_name_01  => 'Content-Type', p_value_01 => 'application/json; charset=utf-8',
      p_name_02  => 'x-api-key',    p_value_02 => rpt_util.cfg('RENDER_API_KEY'));

    l_pdf := apex_web_service.make_rest_request_b(
               p_url              => l_url,
               p_http_method      => 'POST',
               p_body_blob        => l_body,
               p_transfer_timeout => to_number(rpt_util.cfg('RENDER_TIMEOUT', '120')),
               p_wallet_path      => rpt_util.cfg('WALLET_PATH'),
               p_wallet_pwd       => rpt_util.cfg('WALLET_PWD'));

    if apex_web_service.g_status_code <> 200 then
      l_err := 'Render server returned HTTP ' || apex_web_service.g_status_code || ': '
            || utl_raw.cast_to_varchar2(dbms_lob.substr(l_pdf, 1500, 1));
      raise_application_error(-20123, l_err);
    end if;
    log_run(p_code, 'PDF', p_params, dbms_lob.getlength(l_pdf), l_start, 'OK', null);
    return l_pdf;
  exception
    when others then
      l_err := sqlerrm;
      log_run(p_code, 'PDF', p_params, null, l_start, 'ERROR', l_err);
      raise;
  end get_pdf;

  ------------------------------------------------------------------------------
  procedure download(p_code     in varchar2,
                     p_params   in clob     default null,
                     p_filename in varchar2 default null,
                     p_inline   in boolean  default true,
                     p_test     in boolean  default false) is
    l_pdf  blob := get_pdf(p_code, p_params, p_test);
    l_name varchar2(400) := coalesce(p_filename, lower(p_code) || '.pdf');
  begin
    sys.htp.init;
    sys.owa_util.mime_header('application/pdf', false);
    sys.htp.p('Content-Length: ' || dbms_lob.getlength(l_pdf));
    sys.htp.p('Content-Disposition: ' || case when p_inline then 'inline' else 'attachment' end
              || '; filename="' || replace(l_name, '"') || '"');
    sys.htp.p('Cache-Control: no-store');
    sys.owa_util.http_header_close;
    sys.wpg_docload.download_file(l_pdf);
    apex_application.stop_apex_engine;
  end download;

  ------------------------------------------------------------------------------
  procedure ajax is
    l_action varchar2(30)  := upper(coalesce(apex_application.g_x01, 'PAYLOAD'));
    l_code   varchar2(100) := upper(apex_application.g_x02);
    l_test   boolean       := nvl(apex_application.g_x03, 'N') = 'Y';
    l_params clob          := apex_application.g_clob_01;
    l_pdf    blob;
    l_out    json_object_t;
    l_start  timestamp     := systimestamp;
  begin
    if l_params is not null and dbms_lob.getlength(l_params) = 0 then l_params := null; end if;
    if l_action = 'PAYLOAD' then
      rpt_util.htp_clob(get_payload(l_code, l_params, l_test));
      log_run(l_code, 'PAYLOAD', l_params, null, l_start, 'OK', null);
    elsif l_action = 'PDF' then
      l_pdf := get_pdf(l_code, l_params, l_test);
      l_out := json_object_t();
      l_out.put('fileName', lower(l_code) || '.pdf');
      l_out.put('base64', rpt_util.blob_to_base64(l_pdf));
      rpt_util.json_out(l_out);
    else
      raise_application_error(-20100, 'Unknown action ' || l_action);
    end if;
  exception
    when others then
      l_out := json_object_t();
      l_out.put('error', regexp_replace(sqlerrm, '^ORA-2\d{4}: ', ''));
      rpt_util.json_out(l_out);
  end ajax;

end rpt_api;
/
