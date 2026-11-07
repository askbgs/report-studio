--------------------------------------------------------------------------------
-- Report Studio - RPT_UTIL : SQL validation, bind detection, data fetching, JSON I/O
--------------------------------------------------------------------------------
create or replace package rpt_util as

  function cfg(p_key in varchar2, p_default in varchar2 default null) return varchar2;

  -- Raises ORA-20100 unless the statement is a single SELECT / WITH query
  procedure assert_select(p_sql in clob);

  -- Bind variable names (upper case, without colon) found outside strings/comments
  function get_binds(p_sql in clob) return apex_t_varchar2;

  -- {"columns":[{"name":..,"type":..}],"binds":[..]}  (parse only, no execution)
  function describe_sql(p_sql in clob) return json_object_t;

  -- {"columns":[..],"rows":[{COL:value,..}],"truncated":bool}
  function fetch_source(p_sql      in clob,
                        p_params   in json_object_t,
                        p_max_rows in pls_integer default 100000) return json_object_t;

  -- Runs every data source of a stored report:
  -- {"sources":{NAME:{columns,rows}},"params":{..},"user":".."}
  function build_data(p_report_id in number,
                      p_params    in json_object_t default null,
                      p_test      in boolean default false,
                      p_max_rows  in pls_integer default null) return json_object_t;

  -- Same, for unsaved sources sent by the designer: [{"name":..,"sql":..,"params":{..}}]
  function build_data_from(p_sources  in json_array_t,
                           p_params   in json_object_t default null,
                           p_max_rows in pls_integer default null) return json_object_t;

  -- {CODE:"data:image/png;base64,..."} for image elements used in a layout
  function assets_for_layout(p_layout in clob) return json_object_t;
  function asset_data_uri(p_code in varchar2) return clob;

  function blob_to_base64(p_blob in blob) return clob;
  function base64_to_blob(p_b64 in clob) return blob;

  procedure htp_clob(p_clob in clob);
  procedure json_out(p_obj in json_object_t);

  -- Calls the render server's /health from the database (same path as PDF generation):
  -- {"ok":bool,"url","healthUrl","httpStatus","ms","engine","apiKey","active","queued","chromium","error","hint"}
  function server_status return json_object_t;

end rpt_util;
/

create or replace package body rpt_util as

  ------------------------------------------------------------------------------
  function cfg(p_key in varchar2, p_default in varchar2 default null) return varchar2 is
    l_val rpt_config.value%type;
  begin
    select value into l_val from rpt_config where key = upper(p_key);
    return coalesce(l_val, p_default);
  exception
    when no_data_found then return p_default;
  end cfg;

  ------------------------------------------------------------------------------
  -- Small scanner: walks the statement (any length) skipping strings, quoted identifiers and
  -- comments. Returns the first code characters, whether a ';' occurs in code, and the binds.
  procedure scan_sql(p_sql in clob, p_head out varchar2, p_semi out boolean, p_binds out apex_t_varchar2) is
    l_len    pls_integer := nvl(dbms_lob.getlength(p_sql), 0);
    l_buf    varchar2(32767);
    l_bstart pls_integer := 0;
    l_bsize  constant pls_integer := 4000;
    i        pls_integer := 1;
    c        varchar2(1 char);
    n        varchar2(1 char);
    l_name   varchar2(128);
    l_found  boolean;
    l_last   pls_integer := 0;

    function ch(p_pos in pls_integer) return varchar2 is
    begin
      if p_pos > l_len then return null; end if;
      if l_bstart = 0 or p_pos < l_bstart or p_pos >= l_bstart + l_bsize then
        l_bstart := p_pos;
        l_buf := dbms_lob.substr(p_sql, l_bsize + 10, p_pos);
      end if;
      return substr(l_buf, p_pos - l_bstart + 1, 1);
    end ch;

    procedure emit(p_text in varchar2) is
    begin
      if nvl(length(p_head), 0) < 200 then p_head := substr(p_head || p_text, 1, 200); end if;
    end emit;
  begin
    p_binds := apex_t_varchar2();
    p_head  := null;
    p_semi  := false;
    while i <= l_len loop
      c := ch(i);
      n := ch(i + 1);
      if c = '''' then                                  -- string literal
        i := i + 1;
        while i <= l_len loop
          if ch(i) = '''' then
            if ch(i + 1) = '''' then i := i + 2; else exit; end if;
          else
            i := i + 1;
          end if;
        end loop;
        emit(' ''''');
        i := i + 1;
      elsif c = '"' then                                -- quoted identifier
        i := i + 1;
        while i <= l_len and ch(i) <> '"' loop i := i + 1; end loop;
        emit(' "x"');
        i := i + 1;
      elsif c = '-' and n = '-' then                    -- line comment
        while i <= l_len and ch(i) <> chr(10) loop i := i + 1; end loop;
        emit(' ');
      elsif c = '/' and n = '*' then                    -- block comment
        i := i + 2;
        while i <= l_len and not (ch(i) = '*' and ch(i + 1) = '/') loop i := i + 1; end loop;
        emit(' ');
        i := i + 2;
      elsif c = ':' and regexp_like(n, '[A-Za-z]') then -- bind variable
        l_name := null;
        i := i + 1;
        while i <= l_len and regexp_like(ch(i), '[A-Za-z0-9_$#]') and nvl(length(l_name), 0) < 128 loop
          l_name := l_name || ch(i);
          i := i + 1;
        end loop;
        l_found := false;
        for j in 1 .. p_binds.count loop
          if p_binds(j) = upper(l_name) then l_found := true; end if;
        end loop;
        if not l_found then
          p_binds.extend;
          p_binds(p_binds.count) := upper(l_name);
        end if;
        emit(':' || l_name);
      else
        if c = ';' then
          l_last := 1;
        elsif l_last > 0 and c not in (' ', chr(9), chr(10), chr(13)) then
          p_semi := true;   -- code after a ';' => multiple statements
        end if;
        emit(c);
        i := i + 1;
      end if;
    end loop;
    -- p_semi is only true when code follows a ';' (a single trailing ';' is tolerated)
  end scan_sql;

  ------------------------------------------------------------------------------
  procedure assert_select(p_sql in clob) is
    l_head  varchar2(32767);
    l_semi  boolean;
    l_binds apex_t_varchar2;
  begin
    if p_sql is null or dbms_lob.getlength(p_sql) = 0 then
      raise_application_error(-20100, 'SQL query is empty');
    end if;
    scan_sql(p_sql, l_head, l_semi, l_binds);
    l_head := ltrim(l_head, ' ' || chr(9) || chr(10) || chr(13) || '(');
    if not regexp_like(l_head, '^(select|with)([^a-z0-9_$#]|$)', 'i') then
      raise_application_error(-20100, 'Only SELECT or WITH queries are allowed');
    end if;
    if l_semi then
      raise_application_error(-20100, 'Only a single statement is allowed');
    end if;
  end assert_select;

  ------------------------------------------------------------------------------
  function get_binds(p_sql in clob) return apex_t_varchar2 is
    l_head  varchar2(32767);
    l_semi  boolean;
    l_binds apex_t_varchar2;
  begin
    scan_sql(p_sql, l_head, l_semi, l_binds);
    return l_binds;
  end get_binds;

  ------------------------------------------------------------------------------
  function clean_sql(p_sql in clob) return clob is
  begin
    -- DBMS_SQL rejects a trailing semicolon
    return rtrim(rtrim(p_sql, ' ' || chr(9) || chr(10) || chr(13)), ';');
  end clean_sql;

  function type_name(p_type in pls_integer) return varchar2 is
  begin
    return case p_type
             when 1 then 'VARCHAR2' when 96 then 'CHAR' when 2 then 'NUMBER'
             when 100 then 'NUMBER' when 101 then 'NUMBER' when 12 then 'DATE'
             when 180 then 'TIMESTAMP' when 181 then 'TIMESTAMP' when 231 then 'TIMESTAMP'
             when 112 then 'CLOB' when 113 then 'BLOB' else 'VARCHAR2'
           end;
  end type_name;

  ------------------------------------------------------------------------------
  function describe_sql(p_sql in clob) return json_object_t is
    c       integer;
    l_cnt   integer;
    l_desc  dbms_sql.desc_tab2;
    l_cols  json_array_t := json_array_t();
    l_col   json_object_t;
    l_bnd   json_array_t := json_array_t();
    l_binds apex_t_varchar2;
    l_res   json_object_t := json_object_t();
  begin
    assert_select(p_sql);
    l_binds := get_binds(p_sql);
    c := dbms_sql.open_cursor;
    begin
      dbms_sql.parse(c, clean_sql(p_sql), dbms_sql.native);
      dbms_sql.describe_columns2(c, l_cnt, l_desc);
      dbms_sql.close_cursor(c);
    exception
      when others then
        if dbms_sql.is_open(c) then dbms_sql.close_cursor(c); end if;
        raise;
    end;
    for i in 1 .. l_cnt loop
      l_col := json_object_t();
      l_col.put('name', l_desc(i).col_name);
      l_col.put('type', type_name(l_desc(i).col_type));
      l_cols.append(l_col);
    end loop;
    for i in 1 .. l_binds.count loop l_bnd.append(l_binds(i)); end loop;
    l_res.put('columns', l_cols);
    l_res.put('binds', l_bnd);
    return l_res;
  end describe_sql;

  ------------------------------------------------------------------------------
  -- Bind value: explicit parameter (case-insensitive, colon optional) else APEX session state
  function bind_value(p_name in varchar2, p_params in json_object_t, p_found out boolean) return varchar2 is
    l_keys json_key_list;
  begin
    p_found := false;
    if p_params is not null then
      l_keys := p_params.get_keys;
      if l_keys is not null then
        for i in 1 .. l_keys.count loop
          if upper(ltrim(l_keys(i), ':')) = p_name then
            p_found := true;
            if p_params.get(l_keys(i)).is_null then return null; end if;
            return p_params.get_string(l_keys(i));
          end if;
        end loop;
      end if;
    end if;
    if sys_context('APEX$SESSION', 'APP_SESSION') is not null then
      return v(p_name);
    end if;
    return null;
  end bind_value;

  ------------------------------------------------------------------------------
  function fetch_internal(p_sql      in clob,
                          p_params   in json_object_t,
                          p_max_rows in pls_integer,
                          p_used     in out nocopy json_object_t) return json_object_t is
    c        integer;
    l_cnt    integer;
    l_desc   dbms_sql.desc_tab2;
    l_vc     varchar2(32767);
    l_num    number;
    l_date   date;
    l_ts     timestamp_unconstrained;
    l_tstz   timestamp_tz_unconstrained;
    l_tsltz  timestamp_ltz_unconstrained;
    l_clob   clob;
    l_binds  apex_t_varchar2;
    l_val    varchar2(32767);
    l_found  boolean;
    l_cols   json_array_t := json_array_t();
    l_rows   json_array_t := json_array_t();
    l_row    json_object_t;
    l_col    json_object_t;
    l_res    json_object_t := json_object_t();
    l_n      pls_integer := 0;
    l_ignore integer;
    l_more   boolean := false;
    type t_kind is table of varchar2(2) index by pls_integer;
    l_kind   t_kind;
  begin
    assert_select(p_sql);
    l_binds := get_binds(p_sql);
    c := dbms_sql.open_cursor;
    begin
      dbms_sql.parse(c, clean_sql(p_sql), dbms_sql.native);
      for i in 1 .. l_binds.count loop
        l_val := bind_value(l_binds(i), p_params, l_found);
        dbms_sql.bind_variable(c, ':' || l_binds(i), l_val, 32767);
        if l_val is null then p_used.put_null(l_binds(i)); else p_used.put(l_binds(i), l_val); end if;
      end loop;

      dbms_sql.describe_columns2(c, l_cnt, l_desc);
      for i in 1 .. l_cnt loop
        case l_desc(i).col_type
          when 2   then dbms_sql.define_column(c, i, l_num);   l_kind(i) := 'N';
          when 100 then dbms_sql.define_column(c, i, l_num);   l_kind(i) := 'N';
          when 101 then dbms_sql.define_column(c, i, l_num);   l_kind(i) := 'N';
          when 12  then dbms_sql.define_column(c, i, l_date);  l_kind(i) := 'D';
          when 180 then dbms_sql.define_column(c, i, l_ts);    l_kind(i) := 'T';
          when 181 then dbms_sql.define_column(c, i, l_tstz);  l_kind(i) := 'TZ';
          when 231 then dbms_sql.define_column(c, i, l_tsltz); l_kind(i) := 'TL';
          when 112 then dbms_sql.define_column(c, i, l_clob);  l_kind(i) := 'C';
          when 113 then l_kind(i) := 'X';  -- BLOB not supported in data
          when 23  then l_kind(i) := 'X';  -- RAW
          when 8   then l_kind(i) := 'X';  -- LONG
          when 109 then l_kind(i) := 'X';  -- object / XMLTYPE
          else dbms_sql.define_column(c, i, l_vc, 32767);     l_kind(i) := 'V';
        end case;
        l_col := json_object_t();
        l_col.put('name', l_desc(i).col_name);
        l_col.put('type', type_name(l_desc(i).col_type));
        l_cols.append(l_col);
      end loop;

      l_ignore := dbms_sql.execute(c);
      loop
        exit when dbms_sql.fetch_rows(c) = 0;
        if l_n >= p_max_rows then l_more := true; exit; end if;
        l_n := l_n + 1;
        l_row := json_object_t();
        for i in 1 .. l_cnt loop
          case l_kind(i)
            when 'N' then
              dbms_sql.column_value(c, i, l_num);
              if l_num is null then l_row.put_null(l_desc(i).col_name); else l_row.put(l_desc(i).col_name, l_num); end if;
            when 'D' then
              dbms_sql.column_value(c, i, l_date);
              if l_date is null then l_row.put_null(l_desc(i).col_name);
              else l_row.put(l_desc(i).col_name, to_char(l_date, 'YYYY-MM-DD"T"HH24:MI:SS')); end if;
            when 'T' then
              dbms_sql.column_value(c, i, l_ts);
              if l_ts is null then l_row.put_null(l_desc(i).col_name);
              else l_row.put(l_desc(i).col_name, to_char(l_ts, 'YYYY-MM-DD"T"HH24:MI:SS')); end if;
            when 'TZ' then
              dbms_sql.column_value(c, i, l_tstz);
              if l_tstz is null then l_row.put_null(l_desc(i).col_name);
              else l_row.put(l_desc(i).col_name, to_char(l_tstz, 'YYYY-MM-DD"T"HH24:MI:SS')); end if;
            when 'TL' then
              dbms_sql.column_value(c, i, l_tsltz);
              if l_tsltz is null then l_row.put_null(l_desc(i).col_name);
              else l_row.put(l_desc(i).col_name, to_char(l_tsltz, 'YYYY-MM-DD"T"HH24:MI:SS')); end if;
            when 'C' then
              dbms_sql.column_value(c, i, l_clob);
              if l_clob is null then l_row.put_null(l_desc(i).col_name);
              else l_row.put(l_desc(i).col_name, dbms_lob.substr(l_clob, 8000, 1)); end if;
            when 'V' then
              dbms_sql.column_value(c, i, l_vc);
              if l_vc is null then l_row.put_null(l_desc(i).col_name); else l_row.put(l_desc(i).col_name, l_vc); end if;
            else null;
          end case;
        end loop;
        l_rows.append(l_row);
      end loop;
      dbms_sql.close_cursor(c);
    exception
      when others then
        if dbms_sql.is_open(c) then dbms_sql.close_cursor(c); end if;
        raise;
    end;
    l_res.put('columns', l_cols);
    l_res.put('rows', l_rows);
    l_res.put('truncated', l_more);
    return l_res;
  end fetch_internal;

  function fetch_source(p_sql      in clob,
                        p_params   in json_object_t,
                        p_max_rows in pls_integer default 100000) return json_object_t is
    l_used json_object_t := json_object_t();
  begin
    return fetch_internal(p_sql, p_params, p_max_rows, l_used);
  end fetch_source;

  ------------------------------------------------------------------------------
  function merge_obj(p_base in json_object_t, p_over in json_object_t) return json_object_t is
    l_res  json_object_t := json_object_t();
    l_keys json_key_list;
  begin
    if p_base is not null then
      l_keys := p_base.get_keys;
      if l_keys is not null then
        for i in 1 .. l_keys.count loop l_res.put(upper(ltrim(l_keys(i), ':')), p_base.get(l_keys(i))); end loop;
      end if;
    end if;
    if p_over is not null then
      l_keys := p_over.get_keys;
      if l_keys is not null then
        for i in 1 .. l_keys.count loop l_res.put(upper(ltrim(l_keys(i), ':')), p_over.get(l_keys(i))); end loop;
      end if;
    end if;
    return l_res;
  end merge_obj;

  ------------------------------------------------------------------------------
  function build_data_from(p_sources  in json_array_t,
                           p_params   in json_object_t default null,
                           p_max_rows in pls_integer default null) return json_object_t is
    l_res     json_object_t := json_object_t();
    l_srcs    json_object_t := json_object_t();
    l_used    json_object_t := json_object_t();
    l_src     json_object_t;
    l_params  json_object_t;
    l_max     pls_integer := coalesce(p_max_rows, to_number(cfg('MAX_ROWS', '100000')));
    l_err     json_object_t;
  begin
    for i in 0 .. p_sources.get_size - 1 loop
      l_src := treat(p_sources.get(i) as json_object_t);
      l_params := merge_obj(l_src.get_object('params'), p_params);
      begin
        l_srcs.put(upper(l_src.get_string('name')),
                   fetch_internal(l_src.get_clob('sql'), l_params, l_max, l_used));
      exception
        when others then
          l_err := json_object_t();
          l_err.put('error', l_src.get_string('name') || ': ' || sqlerrm);
          l_err.put('rows', json_array_t());
          l_err.put('columns', json_array_t());
          l_srcs.put(upper(l_src.get_string('name')), l_err);
      end;
    end loop;
    l_res.put('sources', l_srcs);
    l_res.put('params', merge_obj(l_used, p_params));
    l_res.put('user', coalesce(sys_context('APEX$SESSION', 'APP_USER'), user));
    return l_res;
  end build_data_from;

  ------------------------------------------------------------------------------
  function build_data(p_report_id in number,
                      p_params    in json_object_t default null,
                      p_test      in boolean default false,
                      p_max_rows  in pls_integer default null) return json_object_t is
    l_arr json_array_t := json_array_t();
    l_src json_object_t;
    l_res json_object_t;
    l_err varchar2(4000);
    l_keys json_key_list;
    l_srcs json_object_t;
  begin
    for r in (select name, sql_text, test_params from rpt_sources where report_id = p_report_id order by seq, name) loop
      l_src := json_object_t();
      l_src.put('name', r.name);
      l_src.put('sql', r.sql_text);
      if p_test and r.test_params is not null then
        l_src.put('params', json_object_t.parse(r.test_params));
      end if;
      l_arr.append(l_src);
    end loop;
    l_res := build_data_from(l_arr, p_params, p_max_rows);
    -- production runs fail loudly if a source failed
    if not p_test then
      l_srcs := l_res.get_object('sources');
      l_keys := l_srcs.get_keys;
      if l_keys is not null then
        for i in 1 .. l_keys.count loop
          l_err := l_srcs.get_object(l_keys(i)).get_string('error');
          if l_err is not null then raise_application_error(-20101, l_err); end if;
        end loop;
      end if;
    end if;
    return l_res;
  end build_data;

  ------------------------------------------------------------------------------
  function blob_to_base64(p_blob in blob) return clob is
  begin
    if p_blob is null then return null; end if;
    return replace(replace(apex_web_service.blob2clobbase64(p_blob), chr(13)), chr(10));
  end blob_to_base64;

  function base64_to_blob(p_b64 in clob) return blob is
  begin
    return apex_web_service.clobbase642blob(p_b64);
  end base64_to_blob;

  function asset_data_uri(p_code in varchar2) return clob is
    l_res clob;
  begin
    for a in (select mime_type, content from rpt_assets where code = upper(p_code)) loop
      l_res := 'data:' || a.mime_type || ';base64,' || blob_to_base64(a.content);
    end loop;
    return l_res;
  end asset_data_uri;

  function assets_for_layout(p_layout in clob) return json_object_t is
    l_res json_object_t := json_object_t();
  begin
    if p_layout is null then return l_res; end if;
    for r in (select distinct upper(jt.src) src
                from json_table(p_layout, '$.bands[*].elements[*]'
                       columns (etype varchar2(30)  path '$.type',
                                src   varchar2(400) path '$.src')) jt
               where jt.etype = 'image'
                 and jt.src is not null
                 and jt.src not like '%{{%') loop
      for a in (select code from rpt_assets where code = r.src) loop
        l_res.put(a.code, asset_data_uri(a.code));
      end loop;
    end loop;
    -- dynamic image tokens ({{IMG_CODE}}): ship every asset so the engine can resolve them
    if dbms_lob.instr(p_layout, '"src":"{{') > 0 then
      for a in (select code from rpt_assets) loop
        if not l_res.has(a.code) then l_res.put(a.code, asset_data_uri(a.code)); end if;
      end loop;
    end if;
    return l_res;
  end assets_for_layout;

  ------------------------------------------------------------------------------
  procedure htp_clob(p_clob in clob) is
    l_len    pls_integer;
    l_offset pls_integer := 1;
    l_chunk  constant pls_integer := 8000;
  begin
    if p_clob is null then return; end if;
    l_len := dbms_lob.getlength(p_clob);
    while l_offset <= l_len loop
      htp.prn(dbms_lob.substr(p_clob, l_chunk, l_offset));
      l_offset := l_offset + l_chunk;
    end loop;
  end htp_clob;

  procedure json_out(p_obj in json_object_t) is
  begin
    htp_clob(p_obj.to_clob);
  end json_out;

  ------------------------------------------------------------------------------
  function server_status return json_object_t is
    l_out    json_object_t := json_object_t();
    l_url    varchar2(4000) := cfg('RENDER_URL');
    l_health varchar2(4000);
    l_resp   clob;
    l_j      json_object_t;
    l_start  timestamp := systimestamp;
    l_stack  varchar2(4000);
    l_key    varchar2(30);

    function elapsed return number is
      l_i interval day to second := systimestamp - l_start;
    begin
      return round((extract(second from l_i) + extract(minute from l_i) * 60) * 1000);
    end elapsed;

    procedure fail(p_error in varchar2, p_hint in varchar2) is
    begin
      l_out.put('ok', false);
      l_out.put('error', p_error);
      l_out.put('hint', p_hint);
    end fail;
  begin
    l_out.put('url', l_url);
    l_out.put('checkedBy', coalesce(sys_context('APEX$SESSION', 'APP_USER'), user));
    if l_url is null then
      fail('RENDER_URL is not set in RPT_CONFIG',
           'update rpt_config set value = ''http://<host>:3900/render'' where key = ''RENDER_URL''; commit;');
      return l_out;
    end if;
    l_health := coalesce(cfg('HEALTH_URL'), regexp_replace(l_url, '/render/?$', '') || '/health');
    l_out.put('healthUrl', l_health);

    apex_web_service.clear_request_headers;
    apex_web_service.set_request_headers(p_name_01 => 'x-api-key', p_value_01 => cfg('RENDER_API_KEY'));
    l_resp := apex_web_service.make_rest_request(
                p_url              => l_health,
                p_http_method      => 'GET',
                p_transfer_timeout => 8,
                p_wallet_path      => cfg('WALLET_PATH'),
                p_wallet_pwd       => cfg('WALLET_PWD'));
    l_out.put('ms', elapsed);
    l_out.put('httpStatus', apex_web_service.g_status_code);

    if apex_web_service.g_status_code <> 200 then
      fail('Health check returned HTTP ' || apex_web_service.g_status_code,
           'Something answered on ' || l_health || ' but it is not the Report Studio render server. Check RENDER_URL (it must end with /render).');
      return l_out;
    end if;

    begin
      l_j := json_object_t.parse(l_resp);
    exception
      when others then
        fail('The health URL did not return JSON', 'Check RENDER_URL: it should point to the Report Studio render server.');
        return l_out;
    end;
    l_key := l_j.get_string('apiKey');
    l_out.put('engine', l_j.get_string('engine'));
    l_out.put('active', l_j.get_number('active'));
    l_out.put('queued', l_j.get_number('queued'));
    l_out.put('chromium', l_j.get_string('chromium'));
    l_out.put('uptime', l_j.get_number('uptime'));
    l_out.put('apiKey', l_key);

    if l_key = 'invalid' then
      fail('The render server rejected the API key',
           'RPT_CONFIG.RENDER_API_KEY must be identical to the API_KEY the render server was started with.');
    elsif l_j.get_string('chromium') like 'error%' then
      fail('Render server is up, but Chromium failed to start: ' || l_j.get_string('chromium'),
           'Reinstall the render server (npm install) or set CHROME_PATH to an installed Chrome.');
    else
      l_out.put('ok', true);
    end if;
    return l_out;
  exception
    when others then
      l_stack := dbms_utility.format_error_stack;
      l_out.put('ms', elapsed);
      fail(regexp_replace(sqlerrm, '^ORA-2\d{4}: ', ''),
           case
             when l_stack like '%ORA-24247%' then
               'Network ACL missing: run db/00_network_acl.sql as SYS/ADMIN for the host and port in RENDER_URL.'
             when l_stack like '%ORA-12541%' or l_stack like '%ORA-12535%' or lower(l_stack) like '%refused%' then
               'Nothing is listening there: start the render server (nssm start ReportStudioRender). If it runs on another machine, start it with HOST=0.0.0.0 and open the port.'
             when l_stack like '%ORA-29024%' or l_stack like '%ORA-28860%' or l_stack like '%ORA-29106%' then
               'HTTPS certificate problem: set WALLET_PATH / WALLET_PWD in RPT_CONFIG, or use http on a private network.'
             when l_stack like '%ORA-12545%' or l_stack like '%ORA-29257%' then
               'Host name not found: check the host in RENDER_URL.'
             when l_stack like '%ORA-29276%' or l_stack like '%timed out%' or l_stack like '%ORA-12170%' then
               'Timed out: a firewall may be blocking the port, or the server is overloaded.'
             else 'Check that RENDER_URL is reachable from the database server (not just from your PC).'
           end);
      return l_out;
  end server_status;

end rpt_util;
/
