--------------------------------------------------------------------------------
-- Report Studio - allow APEX to call the render server  (run ONCE as SYS / ADMIN)
-- Change render_host / render_port to where server.js runs.
--------------------------------------------------------------------------------
define render_host = 'localhost'
define render_port = 3900

declare
  l_apex_schema varchar2(128);
begin
  select schema into l_apex_schema from dba_registry where comp_id = 'APEX';
  dbms_network_acl_admin.append_host_ace(
    host       => '&render_host',
    lower_port => &render_port,
    upper_port => &render_port,
    ace        => xs$ace_type(privilege_list => xs$name_list('connect', 'resolve'),
                              principal_name => l_apex_schema,
                              principal_type => xs_acl.ptype_db));
  dbms_output.put_line('ACL granted to ' || l_apex_schema || ' for &render_host:&render_port');
end;
/
