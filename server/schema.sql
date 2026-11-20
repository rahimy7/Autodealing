CREATE TABLE IF NOT EXISTS admin_users (id uuid PRIMARY KEY, username text NOT NULL UNIQUE, name text NOT NULL, role text NOT NULL CHECK(role IN ('admin','sales')), password_hash text NOT NULL, active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES admin_users(id),csrf text NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS vehicles (id uuid PRIMARY KEY,stock text NOT NULL,vin text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('draft','available','reserved','sold','archived')),data jsonb NOT NULL,purchase_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(purchase_cost>=0),version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_stock ON vehicles(lower(stock));
CREATE UNIQUE INDEX IF NOT EXISTS vehicles_vin ON vehicles(lower(vin)) WHERE vin<>'';
CREATE TABLE IF NOT EXISTS vehicle_photos (id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES vehicles(id),image bytea NOT NULL,mime text NOT NULL,position integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS photos_vehicle ON vehicle_photos(vehicle_id,position,created_at);
ALTER TABLE vehicle_photos ADD COLUMN IF NOT EXISTS cutout bytea;
CREATE TABLE IF NOT EXISTS vehicle_expenses (id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES vehicles(id),description text NOT NULL,amount numeric(14,2) NOT NULL CHECK(amount>0),expense_date date NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sales (id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES vehicles(id),price numeric(14,2) NOT NULL CHECK(price>0),cost numeric(14,2) NOT NULL CHECK(cost>=0),buyer_name text NOT NULL,buyer_phone text NOT NULL DEFAULT '',buyer_email text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',sold_at date NOT NULL,created_by uuid NOT NULL REFERENCES admin_users(id),cancelled_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS sales_active_vehicle ON sales(vehicle_id) WHERE cancelled_at IS NULL;
CREATE TABLE IF NOT EXISTS leads (id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('testdrive','trade','contact')),name text NOT NULL,phone text NOT NULL DEFAULT '',email text NOT NULL DEFAULT '',vehicle_id uuid REFERENCES vehicles(id),data jsonb NOT NULL,status text NOT NULL DEFAULT 'new' CHECK(status IN ('new','contacted','closed')),created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS settings (id text PRIMARY KEY,value jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS site_assets (id text PRIMARY KEY,image bytea NOT NULL,mime text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS audit_log (id bigserial PRIMARY KEY,user_id uuid REFERENCES admin_users(id),action text NOT NULL,entity_id text,created_at timestamptz NOT NULL DEFAULT now());
-- Sales app and Omnicanal integration. Additive only: earlier rows keep working unchanged.
ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS omni_agent_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS admin_users_omni_agent ON admin_users(omni_agent_id) WHERE omni_agent_id IS NOT NULL;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_id uuid REFERENCES admin_users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES admin_users(id);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS omni_contact_id integer;
CREATE TABLE IF NOT EXISTS reservations (id uuid PRIMARY KEY,vehicle_id uuid NOT NULL REFERENCES vehicles(id),seller_id uuid NOT NULL REFERENCES admin_users(id),customer_name text NOT NULL,customer_phone text NOT NULL DEFAULT '',customer_email text NOT NULL DEFAULT '',deposit numeric(14,2) NOT NULL DEFAULT 0 CHECK(deposit>=0),notes text NOT NULL DEFAULT '',expires_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','released','expired','converted')),sale_id uuid REFERENCES sales(id),omni_conversation_id integer,created_by uuid NOT NULL REFERENCES admin_users(id),created_at timestamptz NOT NULL DEFAULT now(),closed_at timestamptz,closed_by uuid REFERENCES admin_users(id));
CREATE UNIQUE INDEX IF NOT EXISTS reservations_active_vehicle ON reservations(vehicle_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS reservations_seller ON reservations(seller_id,created_at);
CREATE TABLE IF NOT EXISTS appointments (id uuid PRIMARY KEY,kind text NOT NULL CHECK(kind IN ('testdrive','visit','delivery','call','followup')),starts_at timestamptz NOT NULL,duration_minutes integer NOT NULL DEFAULT 60 CHECK(duration_minutes BETWEEN 5 AND 600),seller_id uuid REFERENCES admin_users(id),vehicle_id uuid REFERENCES vehicles(id),lead_id uuid REFERENCES leads(id),customer_name text NOT NULL,customer_phone text NOT NULL DEFAULT '',customer_email text NOT NULL DEFAULT '',notes text NOT NULL DEFAULT '',status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','confirmed','completed','cancelled','no_show')),omni_appointment_id integer,omni_contact_id integer,omni_conversation_id integer,sync_error text,created_by uuid NOT NULL REFERENCES admin_users(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS appointments_time ON appointments(starts_at);
CREATE UNIQUE INDEX IF NOT EXISTS appointments_omni ON appointments(omni_appointment_id) WHERE omni_appointment_id IS NOT NULL;
-- A vehicle's page also takes financing requests and showroom appointments. Widens the list only.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='leads'::regclass AND conname='leads_kind_check' AND pg_get_constraintdef(oid) LIKE '%finance%') THEN
    ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_kind_check;
    ALTER TABLE leads ADD CONSTRAINT leads_kind_check CHECK(kind IN ('testdrive','trade','contact','finance','visit'));
  END IF;
END $$;
-- One agenda for the site and Omnicanal. Omnicanal reads and writes this same table: an appointment a
-- salesperson makes and one the virtual agent books are the same row (README: Agenda). Additive only.
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS service text NOT NULL DEFAULT '';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS agent_id integer;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'admin';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
ALTER TABLE appointments ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE appointments ALTER COLUMN kind SET DEFAULT 'visit';
ALTER TABLE appointments ALTER COLUMN status SET DEFAULT 'confirmed';
ALTER TABLE appointments ALTER COLUMN customer_name SET DEFAULT '';
ALTER TABLE appointments ALTER COLUMN notes DROP NOT NULL;
ALTER TABLE appointments ALTER COLUMN created_by DROP NOT NULL;
CREATE SEQUENCE IF NOT EXISTS appointments_omni_seq;
DO $$
DECLARE m integer;
BEGIN
  -- "pending" is an appointment the virtual agent booked that nobody on the team has reviewed.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='appointments'::regclass AND conname='appointments_status_check' AND pg_get_constraintdef(oid) LIKE '%pending%') THEN
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
    ALTER TABLE appointments ADD CONSTRAINT appointments_status_check CHECK(status IN ('pending','scheduled','confirmed','completed','cancelled','no_show'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='appointments'::regclass AND conname='appointments_source_check') THEN
    ALTER TABLE appointments ADD CONSTRAINT appointments_source_check CHECK(source IN ('ai','agent','admin'));
  END IF;
  -- Omnicanal's own appointment number: every row gets one, whoever creates it.
  IF (SELECT column_default FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='appointments' AND column_name='omni_appointment_id') IS NULL THEN
    SELECT coalesce(max(omni_appointment_id),0) INTO m FROM appointments;
    PERFORM setval('appointments_omni_seq', greatest(m,1), m>=1);
    ALTER TABLE appointments ALTER COLUMN omni_appointment_id SET DEFAULT nextval('appointments_omni_seq');
    UPDATE appointments SET omni_appointment_id=nextval('appointments_omni_seq') WHERE omni_appointment_id IS NULL;
    ALTER TABLE appointments ALTER COLUMN omni_appointment_id SET NOT NULL;
    ALTER SEQUENCE appointments_omni_seq OWNED BY appointments.omni_appointment_id;
  END IF;
END $$;
-- "scheduled" is retired: a salesperson's appointment is checked against the agenda, so it is confirmed.
UPDATE appointments SET status='confirmed' WHERE status='scheduled';
-- Keeps the two ways of naming who attends in step, whichever side changes it: the site's seller
-- (admin_users) and Omnicanal's agent. A row Omnicanal inserts without a name gets its contact's.
CREATE OR REPLACE FUNCTION appointments_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cn text; cp text; ce text; ag integer; sl uuid;
BEGIN
  -- The users table is looked up in this table's own schema, not the writer's search_path:
  -- Omnicanal's connections search their own schema first.
  IF TG_OP='INSERT' THEN
    IF NEW.seller_id IS NOT NULL AND NEW.agent_id IS NULL THEN
      EXECUTE format('SELECT omni_agent_id FROM %I.admin_users WHERE id=$1', TG_TABLE_SCHEMA) INTO ag USING NEW.seller_id;
      NEW.agent_id := ag;
    ELSIF NEW.seller_id IS NULL AND NEW.agent_id IS NOT NULL THEN
      EXECUTE format('SELECT id FROM %I.admin_users WHERE omni_agent_id=$1 AND active', TG_TABLE_SCHEMA) INTO sl USING NEW.agent_id;
      NEW.seller_id := sl;
    END IF;
  ELSIF NEW.seller_id IS DISTINCT FROM OLD.seller_id THEN
    EXECUTE format('SELECT omni_agent_id FROM %I.admin_users WHERE id=$1', TG_TABLE_SCHEMA) INTO ag USING NEW.seller_id;
    NEW.agent_id := ag;
  ELSIF NEW.agent_id IS DISTINCT FROM OLD.agent_id THEN
    EXECUTE format('SELECT id FROM %I.admin_users WHERE omni_agent_id=$1 AND active', TG_TABLE_SCHEMA) INTO sl USING NEW.agent_id;
    NEW.seller_id := sl;
  END IF;
  IF NEW.customer_name='' AND NEW.omni_contact_id IS NOT NULL AND to_regclass('omnicanal.contacts') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(nullif(name,''''),nullif(meta_profile_name,''''),''''),coalesce(phone,''''),coalesce(email,'''') FROM omnicanal.contacts WHERE id=$1'
      INTO cn, cp, ce USING NEW.omni_contact_id;
    IF cn IS NOT NULL THEN
      NEW.customer_name := cn;
      IF NEW.customer_phone='' THEN NEW.customer_phone := cp; END IF;
      IF NEW.customer_email='' THEN NEW.customer_email := ce; END IF;
    END IF;
  END IF;
  IF NEW.customer_name='' THEN NEW.customer_name := 'Cliente de Omnicanal'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS appointments_link_trg ON appointments;
CREATE TRIGGER appointments_link_trg BEFORE INSERT OR UPDATE ON appointments FOR EACH ROW EXECUTE FUNCTION appointments_link();
-- The mobile app (/ventas/): three profiles, units loaded from the lot, and quotes. Additive only.
-- "service" is the service department: it loads units and photos and keeps its own agenda.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='admin_users'::regclass AND conname='admin_users_role_check' AND pg_get_constraintdef(oid) LIKE '%service%') THEN
    ALTER TABLE admin_users DROP CONSTRAINT IF EXISTS admin_users_role_check;
    ALTER TABLE admin_users ADD CONSTRAINT admin_users_role_check CHECK(role IN ('admin','sales','service'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='appointments'::regclass AND conname='appointments_kind_check' AND pg_get_constraintdef(oid) LIKE '%service%') THEN
    ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_kind_check;
    ALTER TABLE appointments ADD CONSTRAINT appointments_kind_check CHECK(kind IN ('testdrive','visit','delivery','call','followup','service'));
  END IF;
END $$;
-- Who loaded a unit from the app, and what they noted for administration. Outside `data`, so it
-- never reaches the public catalogue.
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS intake_by uuid REFERENCES admin_users(id);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS intake_notes text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS vehicles_intake ON vehicles(intake_by,created_at) WHERE intake_by IS NOT NULL;
-- A quote keeps the figures it was given and the unit as it was, so it reads the same later.
-- The customer opens it at /cotizacion/<token>.
CREATE TABLE IF NOT EXISTS quotes (id uuid PRIMARY KEY,number integer GENERATED BY DEFAULT AS IDENTITY UNIQUE,token text NOT NULL UNIQUE,vehicle_id uuid NOT NULL REFERENCES vehicles(id),seller_id uuid NOT NULL REFERENCES admin_users(id),customer_name text NOT NULL,customer_phone text NOT NULL DEFAULT '',customer_email text NOT NULL DEFAULT '',price numeric(14,2) NOT NULL CHECK(price>0),fees numeric(14,2) NOT NULL DEFAULT 0 CHECK(fees>=0),tax_rate numeric(6,3) NOT NULL DEFAULT 0 CHECK(tax_rate>=0),down numeric(14,2) NOT NULL DEFAULT 0 CHECK(down>=0),trade_in numeric(14,2) NOT NULL DEFAULT 0 CHECK(trade_in>=0),apr numeric(5,2) NOT NULL DEFAULT 0 CHECK(apr>=0),term_months integer NOT NULL DEFAULT 0 CHECK(term_months BETWEEN 0 AND 120),figures jsonb NOT NULL,vehicle jsonb NOT NULL,notes text NOT NULL DEFAULT '',valid_until date NOT NULL,omni_conversation_id integer,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS quotes_seller ON quotes(seller_id,created_at);
