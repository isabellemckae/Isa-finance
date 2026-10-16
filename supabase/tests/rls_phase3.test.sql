-- Phase 3 tests: CFO conversations, message metadata and usage counters.
-- Runs after rls.test.sql / rls_phase2.test.sql in the same database.

\set ON_ERROR_STOP on
set client_min_messages = warning;
\o /dev/null

set role anon;
select tests.expect_error($$select public.record_ai_usage(1, 1)$$, '42501', 'anon cannot record usage');
select tests.expect_error($$select * from public.ai_usage_daily$$, '42501', 'anon cannot read usage');
reset role;

set role authenticated;
set request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';

-- Usage only goes up, by bounded amounts, for the caller.
select public.record_ai_usage(1200, 300);
select public.record_ai_usage(800, 100);
select tests.assert(
  (select request_count = 2 and input_tokens = 2000 and output_tokens = 400 from public.ai_usage_daily
    where user_id = auth.uid()),
  'usage accumulates for the caller');
select tests.expect_error($$select public.record_ai_usage(-5, 0)$$, '22023', 'negative usage rejected');
select tests.expect_error($$select public.record_ai_usage(5000000, 0)$$, '22023', 'oversized usage rejected');
select tests.expect_error($$update public.ai_usage_daily set request_count = 0$$, '42501', 'usage cannot be reset');
select tests.expect_error($$delete from public.ai_usage_daily$$, '42501', 'usage cannot be deleted');
select tests.expect_error(
  $$insert into public.ai_usage_daily (user_id, day) values (auth.uid(), '2030-01-01')$$,
  '42501', 'usage rows cannot be inserted directly');
select tests.expect_error($$select public.touch_ai_conversation()$$, '42501', 'trigger function not callable');

-- Conversations: metadata stored; appending bumps updated_at; ownership enforced.
create temp table t_conv as select gen_random_uuid() as id;
grant all on t_conv to authenticated;
insert into public.ai_conversations (id, user_id, title, updated_at)
select id, auth.uid(), 'Budget questions', now() - interval '1 day' from t_conv;
insert into public.ai_messages (user_id, conversation_id, role, content, metadata)
select auth.uid(), id, 'assistant', 'Hi', '{"mode":"offline","toolCalls":[]}' from t_conv;
select tests.assert(
  (select updated_at > now() - interval '1 minute' from public.ai_conversations where id = (select id from t_conv)),
  'appending a message bumps the conversation');
select tests.expect_error(
  $$insert into public.ai_messages (user_id, conversation_id, role, content, metadata)
    select auth.uid(), id, 'assistant', 'x', '[1,2]' from t_conv$$,
  '23514', 'metadata must be an object');
select tests.expect_error(
  $$insert into public.ai_messages (user_id, conversation_id, role, content)
    select auth.uid(), conversation, 'user', 'x' from tests.b_ids$$,
  '23503', 'cannot post into another user conversation');
select tests.expect_error($$update public.ai_messages set content = 'edited'$$, '42501', 'messages are immutable');
reset role;
reset request.jwt.claims;

-- User B sees neither A's usage nor A's conversations.
set role authenticated;
set request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
select tests.assert((select count(*) from public.ai_usage_daily) = 0, 'B cannot see A usage');
select tests.assert((select count(*) from public.ai_conversations where title = 'Budget questions') = 0, 'B cannot see A conversations');
select public.record_ai_usage(10, 10);
select tests.assert((select count(*) from public.ai_usage_daily) = 1, 'B records only its own usage');
reset role;
reset request.jwt.claims;

\o
\echo 'Phase 3 RLS tests passed'
