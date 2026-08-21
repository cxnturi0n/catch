-- ============================================================================
-- 020 · DEMO resource folders — populates the "Aurelia Protocol (Demo)"
-- workspace with typed folders + files for presentations. Scoped to that one
-- workspace only. Run AFTER 019_resource_folders.sql. Idempotent.
-- Teardown: delete from public.resource_folders where workspace_id = '11111111-1111-4111-8111-111111111111';
-- ============================================================================
begin;

-- Clean prior demo folders (files inside keep existing, folder_id resets to null).
delete from public.resource_folders where workspace_id = '11111111-1111-4111-8111-111111111111';

-- Folders (fixed ids so file assignment lines up).
insert into public.resource_folders (id, workspace_id, name, section_type, pinned, created_by) values
  ('c0000001-0000-4000-8000-000000000001','11111111-1111-4111-8111-111111111111','Security Playbooks','Playbook', true,  (select id from auth.users where lower(email)='cinicololuca@gmail.com')),
  ('c0000002-0000-4000-8000-000000000002','11111111-1111-4111-8111-111111111111','Team SOPs','SOP', true, (select id from auth.users where lower(email)='cinicololuca@gmail.com')),
  ('c0000003-0000-4000-8000-000000000003','11111111-1111-4111-8111-111111111111','Content Templates','Template', false, (select id from auth.users where lower(email)='cinicololuca@gmail.com')),
  ('c0000004-0000-4000-8000-000000000004','11111111-1111-4111-8111-111111111111','Meeting Notes','Meeting notes', false, (select id from auth.users where lower(email)='cinicololuca@gmail.com')),
  ('c0000005-0000-4000-8000-000000000005','11111111-1111-4111-8111-111111111111','Brand & Marketing','Marketing material', false, (select id from auth.users where lower(email)='cinicololuca@gmail.com')),
  ('c0000006-0000-4000-8000-000000000006','11111111-1111-4111-8111-111111111111','Schedules','Schedule', false, (select id from auth.users where lower(email)='cinicololuca@gmail.com'));

-- Re-file the 4 existing demo resources into the right folders.
update public.resources set folder_id = 'c0000001-0000-4000-8000-000000000001' where id = 'b0000002-0000-4000-8000-000000000002'; -- Anti-Scam Playbook
update public.resources set folder_id = 'c0000002-0000-4000-8000-000000000002' where id = 'b0000001-0000-4000-8000-000000000001'; -- Moderator Handbook
update public.resources set folder_id = 'c0000005-0000-4000-8000-000000000005' where id = 'b0000003-0000-4000-8000-000000000003'; -- Brand Assets
update public.resources set folder_id = 'c0000006-0000-4000-8000-000000000006' where id = 'b0000004-0000-4000-8000-000000000004'; -- Shift Schedule Sheet

-- Extra files so folders have realistic counts (external links → no storage needed).
insert into public.resources (workspace_id, kind, title, description, external_url, visibility, created_by, folder_id) values
  ('11111111-1111-4111-8111-111111111111','external_link','Raid Response Playbook','What to do during a coordinated attack','https://notion.so/aurelia/raid-response','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000001-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111','external_link','Impersonation Checklist','Spot & remove fake team accounts','https://notion.so/aurelia/impersonation','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000001-0000-4000-8000-000000000001'),
  ('11111111-1111-4111-8111-111111111111','external_link','Ticket Handling SOP','Support ticket workflow','https://notion.so/aurelia/tickets-sop','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000002-0000-4000-8000-000000000002'),
  ('11111111-1111-4111-8111-111111111111','external_link','Onboarding SOP','New moderator onboarding steps','https://notion.so/aurelia/onboarding-sop','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000002-0000-4000-8000-000000000002'),
  ('11111111-1111-4111-8111-111111111111','external_link','AMA Recap Template','Fill-in template for AMA summaries','https://docs.google.com/aurelia-ama-template','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000003-0000-4000-8000-000000000003'),
  ('11111111-1111-4111-8111-111111111111','external_link','Weekly Update Template','Community weekly recap layout','https://docs.google.com/aurelia-weekly','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000003-0000-4000-8000-000000000003'),
  ('11111111-1111-4111-8111-111111111111','external_link','Announcement Template','Standard announcement format','https://docs.google.com/aurelia-announce','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000003-0000-4000-8000-000000000003'),
  ('11111111-1111-4111-8111-111111111111','external_link','Team Sync — Jul 28','Notes from the weekly mod sync','https://notion.so/aurelia/sync-jul28','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000004-0000-4000-8000-000000000004'),
  ('11111111-1111-4111-8111-111111111111','external_link','Kickoff Meeting Notes','Client kickoff summary','https://notion.so/aurelia/kickoff','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000004-0000-4000-8000-000000000004'),
  ('11111111-1111-4111-8111-111111111111','external_link','Logo Pack v3','Latest brand logos','https://drive.google.com/aurelia-logos','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000005-0000-4000-8000-000000000005'),
  ('11111111-1111-4111-8111-111111111111','external_link','Social Card Kit','Templated social graphics','https://drive.google.com/aurelia-social','team',(select id from auth.users where lower(email)='cinicololuca@gmail.com'),'c0000005-0000-4000-8000-000000000005');

commit;
