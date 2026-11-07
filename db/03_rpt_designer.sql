--------------------------------------------------------------------------------
-- Report Studio - RPT_DESIGNER : Ajax back end of the designer page
-- APEX Application Process (Ajax Callback) "RPT_AJAX":   rpt_designer.ajax;
--   x01 = action, x02 = report id, p_clob_01 = JSON payload
-- Protect that process with an authorization scheme for report designers:
-- PREVIEW_DATA runs designer-supplied SELECT statements as the parsing schema.
--------------------------------------------------------------------------------
create or replace package rpt_designer as
  procedure ajax;
end rpt_designer;
/

create or replace package body rpt_designer as

  c_app_user constant varchar2(30) := 'APP_USER';

  function app_user return varchar2 is
  begin
    return coalesce(sys_context('APEX$SESSION', c_app_user), user);
  end app_user;

  ------------------------------------------------------------------------------
  function report_obj(p_id in number) return json_object_t is
    l_obj json_object_t := json_object_t();
  begin
    for r in (select * from rpt_reports where report_id = p_id) loop
      l_obj.put('id', r.report_id);
      l_obj.put('code', r.code);
      l_obj.put('name', r.name);
      l_obj.put('description', r.description);
      l_obj.put('status', r.status);
      l_obj.put('versionNo', r.version_no);
      l_obj.put('updatedOn', to_char(coalesce(r.updated_on, r.created_on), 'YYYY-MM-DD"T"HH24:MI:SS'));
      l_obj.put('updatedBy', coalesce(r.updated_by, r.created_by));
      if r.layout is not null then
        l_obj.put('layout', json_object_t.parse(r.layout));
      else
        l_obj.put_null('layout');
      end if;
      return l_obj;
    end loop;
    raise_application_error(-20110, 'Report ' || p_id || ' not found');
  end report_obj;

  function sources_arr(p_id in number) return json_array_t is
    l_arr json_array_t := json_array_t();
    l_src json_object_t;
  begin
    for s in (select * from rpt_sources where report_id = p_id order by seq, name) loop
      l_src := json_object_t();
      l_src.put('name', s.name);
      l_src.put('sql', s.sql_text);
      if s.test_params is not null then l_src.put('params', json_object_t.parse(s.test_params));
      else l_src.put('params', json_object_t()); end if;
      l_arr.append(l_src);
    end loop;
    return l_arr;
  end sources_arr;

  function assets_arr return json_array_t is
    l_arr json_array_t := json_array_t();
    l_a   json_object_t;
  begin
    for a in (select code, mime_type, file_name, dbms_lob.getlength(content) bytes from rpt_assets order by code) loop
      l_a := json_object_t();
      l_a.put('code', a.code);
      l_a.put('mime', a.mime_type);
      l_a.put('fileName', a.file_name);
      l_a.put('bytes', a.bytes);
      l_arr.append(l_a);
    end loop;
    return l_arr;
  end assets_arr;

  ------------------------------------------------------------------------------
  function load_report(p_id in number) return json_object_t is
    l_out json_object_t := json_object_t();
  begin
    if p_id is null then
      l_out.put_null('report');
      l_out.put('sources', json_array_t());
    else
      l_out.put('report', report_obj(p_id));
      l_out.put('sources', sources_arr(p_id));
    end if;
    l_out.put('assets', assets_arr);
    l_out.put('user', app_user);
    return l_out;
  end load_report;

  ------------------------------------------------------------------------------
  procedure save_sources(p_id in number, p_sources in json_array_t) is
    l_src  json_object_t;
    l_par  json_object_t;
    l_name varchar2(30);
    l_sql  clob;
    l_tp   clob;
  begin
    delete from rpt_sources where report_id = p_id;
    if p_sources is null then return; end if;
    for i in 0 .. p_sources.get_size - 1 loop
      l_src := treat(p_sources.get(i) as json_object_t);
      l_name := upper(l_src.get_string('name'));
      l_sql  := l_src.get_clob('sql');
      rpt_util.assert_select(l_sql);
      l_par  := l_src.get_object('params');
      l_tp   := case when l_par is not null then l_par.to_clob end;
      insert into rpt_sources (report_id, name, sql_text, test_params, seq)
      values (p_id, l_name, l_sql, l_tp, (i + 1) * 10);
    end loop;
  end save_sources;

  function save_report(p_id in number, p_in in json_object_t) return json_object_t is
    l_id      number := p_id;
    l_rep     json_object_t := p_in.get_object('report');
    l_layout  clob := p_in.get_object('layout').to_clob;
    l_sources json_array_t := p_in.get_array('sources');
    l_ver     number;
    l_out     json_object_t := json_object_t();
    l_code    rpt_reports.code%type := upper(trim(l_rep.get_string('code')));
    l_name    rpt_reports.name%type := trim(l_rep.get_string('name'));
    l_desc    rpt_reports.description%type := l_rep.get_string('description');
    l_status  rpt_reports.status%type := l_rep.get_string('status');
    l_src_clob clob := case when l_sources is not null then l_sources.to_clob else '[]' end;
    l_user    varchar2(255) := app_user;
  begin
    if l_code is null or not regexp_like(l_code, '^[A-Z0-9_\-]+$') then
      raise_application_error(-20111, 'Report code is required (letters, digits, _ and -)');
    end if;
    if l_name is null then
      raise_application_error(-20111, 'Report name is required');
    end if;
    if l_id is null then
      insert into rpt_reports (code, name, description, layout, status, version_no)
      values (l_code, l_name, l_desc, l_layout, coalesce(l_status, 'DRAFT'), 1)
      returning report_id, version_no into l_id, l_ver;
    else
      update rpt_reports
         set code        = l_code,
             name        = l_name,
             description = l_desc,
             status      = coalesce(l_status, status),
             layout      = l_layout,
             version_no  = version_no + 1,
             updated_by  = l_user,
             updated_on  = sysdate
       where report_id = l_id
      returning version_no into l_ver;
      if sql%rowcount = 0 then raise_application_error(-20110, 'Report ' || l_id || ' not found'); end if;
    end if;
    save_sources(l_id, l_sources);
    insert into rpt_versions (report_id, version_no, layout, sources)
    values (l_id, l_ver, l_layout, l_src_clob);
    -- keep the last 50 versions
    delete from rpt_versions
     where report_id = l_id
       and version_no <= l_ver - 50;
    commit;
    l_out.put('id', l_id);
    l_out.put('versionNo', l_ver);
    l_out.put('ok', true);
    return l_out;
  exception
    when dup_val_on_index then
      rollback;
      raise_application_error(-20112, 'Another report already uses code ' || l_code);
  end save_report;

  ------------------------------------------------------------------------------
  function preview_data(p_in in json_object_t) return json_object_t is
    l_max pls_integer := coalesce(p_in.get_number('maxRows'), to_number(rpt_util.cfg('PREVIEW_MAX_ROWS', '500')));
    l_src json_array_t := p_in.get_array('sources');
  begin
    if l_src is null then l_src := json_array_t(); end if;
    return rpt_util.build_data_from(l_src, p_in.get_object('params'), l_max);
  end preview_data;

  ------------------------------------------------------------------------------
  function asset_get(p_in in json_object_t) return json_object_t is
    l_out  json_object_t := json_object_t();
    l_code varchar2(100) := upper(p_in.get_string('code'));
  begin
    l_out.put('code', l_code);
    l_out.put('dataUri', rpt_util.asset_data_uri(l_code));
    return l_out;
  end asset_get;

  function asset_save(p_in in json_object_t) return json_object_t is
    l_code varchar2(100) := upper(trim(p_in.get_string('code')));
    l_blob blob := rpt_util.base64_to_blob(p_in.get_clob('base64'));
    l_mime varchar2(255) := p_in.get_string('mime');
    l_file varchar2(400) := p_in.get_string('fileName');
    l_out  json_object_t := json_object_t();
  begin
    if l_code is null or not regexp_like(l_code, '^[A-Z0-9_\-]+$') then
      raise_application_error(-20113, 'Image code is required (letters, digits, _ and -)');
    end if;
    if l_mime not like 'image/%' then
      raise_application_error(-20113, 'Only images can be uploaded');
    end if;
    merge into rpt_assets a
    using (select l_code code from dual) s
       on (a.code = s.code)
     when matched then update set a.content = l_blob, a.mime_type = l_mime, a.file_name = l_file
     when not matched then insert (code, mime_type, file_name, content)
                          values (l_code, l_mime, l_file, l_blob);
    commit;
    l_out.put('ok', true);
    l_out.put('assets', assets_arr);
    return l_out;
  end asset_save;

  function asset_delete(p_in in json_object_t) return json_object_t is
    l_out  json_object_t := json_object_t();
    l_code varchar2(100) := upper(p_in.get_string('code'));
  begin
    delete from rpt_assets where code = l_code;
    commit;
    l_out.put('ok', true);
    l_out.put('assets', assets_arr);
    return l_out;
  end asset_delete;

  ------------------------------------------------------------------------------
  -- Export bundle: report + sources + the images it uses (portable between environments)
  function export_bundle(p_id in number) return json_object_t is
    l_out    json_object_t := json_object_t();
    l_rep    json_object_t := report_obj(p_id);
    l_assets json_array_t := json_array_t();
    l_a      json_object_t;
    l_layout clob;
    l_used   json_object_t;
    l_keys   json_key_list;
  begin
    select layout into l_layout from rpt_reports where report_id = p_id;
    l_used := rpt_util.assets_for_layout(l_layout);
    l_keys := l_used.get_keys;
    if l_keys is not null then
      for i in 1 .. l_keys.count loop
        for a in (select code, mime_type, file_name, content from rpt_assets where code = l_keys(i)) loop
          l_a := json_object_t();
          l_a.put('code', a.code);
          l_a.put('mime', a.mime_type);
          l_a.put('fileName', a.file_name);
          l_a.put('base64', rpt_util.blob_to_base64(a.content));
          l_assets.append(l_a);
        end loop;
      end loop;
    end if;
    l_out.put('format', 'report-studio');
    l_out.put('formatVersion', 1);
    l_out.put('exportedOn', to_char(sysdate, 'YYYY-MM-DD"T"HH24:MI:SS'));
    l_out.put('report', l_rep);
    l_out.put('sources', sources_arr(p_id));
    l_out.put('assets', l_assets);
    return l_out;
  end export_bundle;

  function import_bundle(p_in in json_object_t) return json_object_t is
    l_b      json_object_t := p_in.get_object('bundle');
    l_rep    json_object_t;
    l_assets json_array_t;
    l_a      json_object_t;
    l_id     number;
    l_save   json_object_t := json_object_t();
    l_meta   json_object_t := json_object_t();
    l_code   varchar2(100);
    l_acode  varchar2(100);
    l_amime  varchar2(255);
    l_afile  varchar2(400);
    l_ablob  blob;
  begin
    if l_b is null then l_b := p_in; end if;
    l_rep    := l_b.get_object('report');
    l_assets := l_b.get_array('assets');
    if l_b.get_string('format') is null or l_b.get_string('format') <> 'report-studio' then
      raise_application_error(-20114, 'Not a Report Studio export file');
    end if;
    l_code := upper(coalesce(p_in.get_string('newCode'), l_rep.get_string('code')));
    begin
      select report_id into l_id from rpt_reports where code = l_code;
    exception when no_data_found then l_id := null;
    end;
    if l_assets is not null then
      for i in 0 .. l_assets.get_size - 1 loop
        l_a     := treat(l_assets.get(i) as json_object_t);
        l_acode := upper(l_a.get_string('code'));
        l_amime := l_a.get_string('mime');
        l_afile := l_a.get_string('fileName');
        l_ablob := rpt_util.base64_to_blob(l_a.get_clob('base64'));
        merge into rpt_assets a
        using (select l_acode code from dual) s
           on (a.code = s.code)
         when matched then update set a.content = l_ablob, a.mime_type = l_amime
         when not matched then insert (code, mime_type, file_name, content)
              values (s.code, l_amime, l_afile, l_ablob);
      end loop;
    end if;
    l_meta.put('code', l_code);
    l_meta.put('name', l_rep.get_string('name'));
    l_meta.put('description', l_rep.get_string('description'));
    l_meta.put('status', 'DRAFT');
    l_save.put('report', l_meta);
    l_save.put('layout', l_rep.get_object('layout'));
    l_save.put('sources', l_b.get_array('sources'));
    return save_report(l_id, l_save);
  end import_bundle;

  ------------------------------------------------------------------------------
  function versions(p_id in number) return json_object_t is
    l_out json_object_t := json_object_t();
    l_arr json_array_t := json_array_t();
    l_v   json_object_t;
  begin
    for v in (select version_id, version_no, saved_by, saved_on
                from rpt_versions where report_id = p_id
               order by version_no desc fetch first 50 rows only) loop
      l_v := json_object_t();
      l_v.put('versionId', v.version_id);
      l_v.put('versionNo', v.version_no);
      l_v.put('savedBy', v.saved_by);
      l_v.put('savedOn', to_char(v.saved_on, 'YYYY-MM-DD"T"HH24:MI:SS'));
      l_arr.append(l_v);
    end loop;
    l_out.put('versions', l_arr);
    return l_out;
  end versions;

  function version_get(p_in in json_object_t) return json_object_t is
    l_out json_object_t := json_object_t();
    l_vid number := p_in.get_number('versionId');
  begin
    for v in (select layout, sources, version_no from rpt_versions where version_id = l_vid) loop
      l_out.put('versionNo', v.version_no);
      l_out.put('layout', json_object_t.parse(v.layout));
      l_out.put('sources', json_array_t.parse(v.sources));
    end loop;
    return l_out;
  end version_get;

  function delete_report(p_id in number) return json_object_t is
    l_out json_object_t := json_object_t();
  begin
    delete from rpt_reports where report_id = p_id;
    commit;
    l_out.put('ok', true);
    return l_out;
  end delete_report;

  ------------------------------------------------------------------------------
  procedure ajax is
    l_action varchar2(30) := upper(apex_application.g_x01);
    l_id     number := to_number(apex_application.g_x02 default null on conversion error);
    l_in     json_object_t;
    l_out    json_object_t;
  begin
    if apex_application.g_clob_01 is not null and dbms_lob.getlength(apex_application.g_clob_01) > 0 then
      l_in := json_object_t.parse(apex_application.g_clob_01);
    else
      l_in := json_object_t();
    end if;

    l_out := case l_action
               when 'LOAD'         then load_report(l_id)
               when 'SAVE'         then save_report(l_id, l_in)
               when 'DESCRIBE'     then rpt_util.describe_sql(l_in.get_clob('sql'))
               when 'PREVIEW_DATA' then preview_data(l_in)
               when 'ASSETS'       then json_object_t('{}')
               when 'ASSET_GET'    then asset_get(l_in)
               when 'ASSET_SAVE'   then asset_save(l_in)
               when 'ASSET_DELETE' then asset_delete(l_in)
               when 'EXPORT'       then export_bundle(l_id)
               when 'IMPORT'       then import_bundle(l_in)
               when 'VERSIONS'     then versions(l_id)
               when 'VERSION_GET'  then version_get(l_in)
               when 'DELETE'       then delete_report(l_id)
               when 'SERVER_STATUS' then rpt_util.server_status
             end;
    if l_out is null then
      raise_application_error(-20100, 'Unknown action ' || l_action);
    end if;
    if l_action = 'ASSETS' then l_out.put('assets', assets_arr); end if;
    rpt_util.json_out(l_out);
  exception
    when others then
      rollback;
      l_out := json_object_t();
      l_out.put('error', regexp_replace(sqlerrm, '^ORA-2\d{4}: ', ''));
      rpt_util.json_out(l_out);
  end ajax;

end rpt_designer;
/
