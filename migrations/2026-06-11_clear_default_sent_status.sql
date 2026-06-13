-- Allow status to be null (removes the bogus NOT NULL constraint).
alter table contacts alter column status drop not null;

-- Clear the 'Sent' default that was incorrectly applied to all new contacts.
-- Only resets contacts where no email thread exists.
update contacts
set status = null
where status = 'Sent'
  and id not in (select contact_id from email_threads where contact_id is not null);
