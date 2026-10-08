/**
 * DEV ONLY. Fills the in-browser database (PGlite, stored in this browser's IndexedDB) with
 * fake clients, jobs and billing so the app can be worked on with realistic content.
 *
 * It is loaded through a dynamic import inside `if (!import.meta.env.PROD)`, so it is not part of
 * the production bundle, and the production server never runs it. Nothing here can reach the
 * production database: the browser database is local to this machine.
 *
 * Turn it off:  localStorage.setItem("frx.noDemo", "1")
 * Start over:   delete the "app-db" IndexedDB database in the browser devtools and reload.
 */
import { db, dbReady, schema } from "../db";
import { initials, isoDate } from "./format";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";

const NO_DEMO_KEY = "frx.noDemo";

type Line = { description: string; quantity: number; unit: string; unit_price: number };

function money(lines: Line[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const gst = Math.round(subtotal * 0.05 * 100) / 100;
  const qst = Math.round(subtotal * 0.09975 * 100) / 100;
  return { subtotal, gst, qst, total: Math.round((subtotal + gst + qst) * 100) / 100 };
}

let running: Promise<void> | null = null;

/** Single-flight: React dev mode runs effects twice, which must not create the data twice. */
export function seedDemoData() {
  if (!running) running = seedDemoDataInner();
  return running;
}

async function seedDemoDataInner() {
  if (localStorage.getItem(NO_DEMO_KEY) === "1") return;
  await dbReady;
  const existing = await db.select({ id: schema.clients.id }).from(schema.clients).limit(1);
  if (existing.length > 0) {
    await seedQuoteChanges();
    await seedBillingFiles();
    return;
  }

  // ---- people (local-only demo accounts) ----
  const [marc] = await db
    .insert(schema.users)
    .values({
      name: "Marc Tremblay",
      email: "marc@frxconstruction.ca",
      password: await hashPassword("frx123"),
      user_type: "internal",
      title: "Project Manager",
      phone: "514-555-0142",
      is_active: 1,
      is_admin: 0,
      avatar_initials: initials("Marc Tremblay"),
      locale: "fr",
      theme: "light",
      all_clients: 1,
      must_change_password: 0,
      tutorial_done: 1,
    })
    .returning();

  // ---- clients ----
  const clientRows = await db
    .insert(schema.clients)
    .values([
      {
        name: "Sophie Gagnon",
        company_name: "Nordique Immobilier",
        email: "sophie@nordique.com",
        phone: "514-555-0110",
        address: "1200 rue Sherbrooke O.",
        city: "Montréal",
        state: "QC",
        zip: "H3G 1H4",
        notes: "Fake demo client. Prefers email, pays net 30.",
        status: "active",
      },
      {
        name: "Daniel Roy",
        company_name: "Groupe Laval Développement",
        email: "droy@lavaldev.example",
        phone: "450-555-0188",
        address: "3050 boul. Le Carrefour",
        city: "Laval",
        state: "QC",
        zip: "H7T 2J7",
        notes: "Fake demo client. Three retail units under way.",
        status: "active",
      },
      {
        name: "Isabelle Fortin",
        company_name: "Boulangerie du Plateau",
        email: "isabelle@boulangerieplateau.example",
        phone: "514-555-0166",
        address: "845 av. du Mont-Royal E.",
        city: "Montréal",
        state: "QC",
        zip: "H2J 1W8",
        notes: "Fake demo client. Kitchen fit-out.",
        status: "active",
      },
      {
        name: "Dr. Karim Haddad",
        company_name: "Clinique Santé Griffintown",
        email: "khaddad@cliniquegriffintown.example",
        phone: "514-555-0129",
        address: "700 rue Ottawa",
        city: "Montréal",
        state: "QC",
        zip: "H3C 1R8",
        notes: "Fake demo client. Prospect, quote pending.",
        status: "prospect",
      },
    ])
    .returning();
  const [nordique, laval, boulangerie, clinique] = clientRows;

  const [sophie] = await db
    .insert(schema.users)
    .values({
      name: "Sophie Gagnon",
      email: "sophie@nordique.com",
      password: await hashPassword("client123"),
      user_type: "external",
      title: "Asset Manager",
      phone: "514-555-0110",
      is_active: 1,
      is_admin: 0,
      avatar_initials: initials("Sophie Gagnon"),
      locale: "fr",
      theme: "light",
      all_clients: 0,
      must_change_password: 0,
      tutorial_done: 1,
    })
    .returning();
  await db.insert(schema.client_users).values({ client_id: nordique.id, user_id: sophie.id, is_primary: 1 });
  await db.insert(schema.user_clients).values({ user_id: sophie.id, client_id: nordique.id });

  // ---- projects ----
  const projectRows = await db
    .insert(schema.projects)
    .values([
      {
        client_id: nordique.id,
        name: "Tour Sherbrooke — Lobby renovation",
        project_number: "FRX-2601",
        description: "Fake demo job. Full renovation of a 6,000 sq ft office lobby.",
        status: "active",
        phase: "interiors",
        project_type: "Commercial",
        address: "1200 rue Sherbrooke O.",
        city: "Montréal",
        start_date: isoDate(-70),
        end_date: isoDate(35),
        budget: 480000,
        spent: 312500,
        sort_order: 0,
        geo_lat: 45.5017,
        geo_lng: -73.5784,
        geo_radius_m: 200,
        require_geofence: 0,
      },
      {
        client_id: nordique.id,
        name: "Édifice Peel — Tenant fit-out, 4th floor",
        project_number: "FRX-2602",
        description: "Fake demo job. Open-plan fit-out with two meeting rooms.",
        status: "planning",
        phase: "preconstruction",
        project_type: "Commercial",
        address: "1010 rue Peel",
        city: "Montréal",
        start_date: isoDate(14),
        end_date: isoDate(120),
        budget: 265000,
        spent: 8200,
        sort_order: 1,
        geo_lat: 45.5009,
        geo_lng: -73.5712,
        geo_radius_m: 150,
        require_geofence: 0,
      },
      {
        client_id: laval.id,
        name: "Centre Carrefour — Retail unit 114",
        project_number: "FRX-2603",
        description: "Fake demo job. Shell and fit-out of a 2,400 sq ft retail unit.",
        status: "active",
        phase: "structure",
        project_type: "Commercial",
        address: "3050 boul. Le Carrefour",
        city: "Laval",
        start_date: isoDate(-40),
        end_date: isoDate(60),
        budget: 390000,
        spent: 141000,
        sort_order: 2,
        geo_lat: 45.5665,
        geo_lng: -73.7449,
        geo_radius_m: 250,
        require_geofence: 1,
      },
      {
        client_id: laval.id,
        name: "Centre Carrefour — Retail unit 118",
        project_number: "FRX-2604",
        description: "Fake demo job. Completed last quarter.",
        status: "completed",
        phase: "closeout",
        project_type: "Commercial",
        address: "3050 boul. Le Carrefour",
        city: "Laval",
        start_date: isoDate(-190),
        end_date: isoDate(-45),
        budget: 310000,
        spent: 302400,
        sort_order: 3,
        geo_lat: 45.5665,
        geo_lng: -73.7449,
        geo_radius_m: 250,
        require_geofence: 0,
      },
      {
        client_id: boulangerie.id,
        name: "Boulangerie du Plateau — Production kitchen",
        project_number: "FRX-2605",
        description: "Fake demo job. Commercial kitchen with new ventilation and floor drains.",
        status: "active",
        phase: "envelope",
        project_type: "Commercial",
        address: "845 av. du Mont-Royal E.",
        city: "Montréal",
        start_date: isoDate(-25),
        end_date: isoDate(45),
        budget: 128000,
        spent: 54700,
        sort_order: 4,
        geo_lat: 45.5254,
        geo_lng: -73.5772,
        geo_radius_m: 100,
        require_geofence: 0,
      },
      {
        client_id: clinique.id,
        name: "Clinique Griffintown — Phase 1",
        project_number: "FRX-2606",
        description: "Fake demo job. On hold until permit approval.",
        status: "on_hold",
        phase: "preconstruction",
        project_type: "Institutional",
        address: "700 rue Ottawa",
        city: "Montréal",
        start_date: isoDate(30),
        end_date: isoDate(210),
        budget: 540000,
        spent: 0,
        sort_order: 5,
        geo_lat: 45.4936,
        geo_lng: -73.5608,
        geo_radius_m: 200,
        require_geofence: 0,
      },
    ])
    .returning();
  const [lobby, peel, unit114, , kitchen, clinicProject] = projectRows;

  await db.insert(schema.project_members).values(
    projectRows.slice(0, 5).map((p) => ({ project_id: p.id, user_id: marc.id, role: "Project Manager" })),
  );

  // ---- tasks ----
  await db.insert(schema.project_tasks).values([
    { project_id: lobby.id, title: "Demolish old reception desk", description: null, start_date: isoDate(-60), end_date: isoDate(-52), status: "completed", priority: "medium", assigned_to: marc.id },
    { project_id: lobby.id, title: "Install ceiling grid and lighting", description: null, start_date: isoDate(-30), end_date: isoDate(-8), status: "completed", priority: "high", assigned_to: marc.id },
    { project_id: lobby.id, title: "Stone floor installation", description: "Waiting on last pallet.", start_date: isoDate(-6), end_date: isoDate(9), status: "in_progress", priority: "high", assigned_to: marc.id },
    { project_id: lobby.id, title: "Millwork delivery and install", description: null, start_date: isoDate(10), end_date: isoDate(22), status: "not_started", priority: "medium", assigned_to: marc.id },
    { project_id: lobby.id, title: "Final cleaning and walk-through", description: null, start_date: isoDate(28), end_date: isoDate(35), status: "not_started", priority: "low", assigned_to: null },
    { project_id: unit114.id, title: "Pour slab and curing", description: null, start_date: isoDate(-20), end_date: isoDate(-6), status: "completed", priority: "high", assigned_to: marc.id },
    { project_id: unit114.id, title: "Steel framing", description: null, start_date: isoDate(-5), end_date: isoDate(8), status: "in_progress", priority: "high", assigned_to: marc.id },
    { project_id: unit114.id, title: "Electrical rough-in", description: "Blocked by inspection date.", start_date: isoDate(9), end_date: isoDate(20), status: "blocked", priority: "critical", assigned_to: marc.id },
    { project_id: kitchen.id, title: "Hood and ventilation install", description: null, start_date: isoDate(-4), end_date: isoDate(12), status: "in_progress", priority: "high", assigned_to: marc.id },
    { project_id: kitchen.id, title: "Epoxy flooring", description: null, start_date: isoDate(14), end_date: isoDate(20), status: "not_started", priority: "medium", assigned_to: null },
    { project_id: peel.id, title: "Permit submission", description: null, start_date: isoDate(0), end_date: isoDate(10), status: "in_progress", priority: "high", assigned_to: marc.id },
  ]);

  // ---- budget ----
  await db.insert(schema.budget_items).values([
    { project_id: lobby.id, category: "General conditions", description: "Site supervision", estimated: 42000, actual: 31000, status: "invoiced" },
    { project_id: lobby.id, category: "Concrete", description: "Floor leveling", estimated: 38000, actual: 36200, status: "paid" },
    { project_id: lobby.id, category: "Carpentry", description: "Millwork package", estimated: 96000, actual: 40000, status: "committed" },
    { project_id: lobby.id, category: "MEP", description: "Lighting and controls", estimated: 118000, actual: 105300, status: "invoiced" },
    { project_id: unit114.id, category: "Steel", description: "Structural steel", estimated: 87000, actual: 62000, status: "invoiced" },
    { project_id: unit114.id, category: "Concrete", description: "Slab and footings", estimated: 54000, actual: 54000, status: "paid" },
    { project_id: kitchen.id, category: "MEP", description: "Ventilation and gas", estimated: 46000, actual: 28000, status: "committed" },
    { project_id: kitchen.id, category: "Sitework", description: "Floor drains", estimated: 19000, actual: 16800, status: "paid" },
  ]);

  // ---- calendar ----
  await db.insert(schema.calendar_events).values([
    { project_id: lobby.id, title: "Stone delivery", event_date: isoDate(2), end_date: null, event_type: "delivery", description: "Last pallet from supplier." },
    { project_id: lobby.id, title: "Owner walk-through", event_date: isoDate(30), end_date: null, event_type: "meeting", description: null },
    { project_id: unit114.id, title: "City inspection (framing)", event_date: isoDate(7), end_date: null, event_type: "inspection", description: null },
    { project_id: kitchen.id, title: "Hood delivery", event_date: isoDate(5), end_date: null, event_type: "delivery", description: null },
    { project_id: peel.id, title: "Kick-off meeting", event_date: isoDate(14), end_date: null, event_type: "milestone", description: null },
    { project_id: clinicProject.id, title: "Permit decision expected", event_date: isoDate(21), end_date: null, event_type: "milestone", description: null },
  ]);

  // ---- field logs, RFIs, change orders ----
  await db.insert(schema.daily_logs).values([
    { project_id: lobby.id, log_date: isoDate(-1), weather: "Cloudy, 8°C", crew_count: 9, notes: "Stone crew on site. Electrical finished panel labels.", created_by: marc.id },
    { project_id: lobby.id, log_date: isoDate(-2), weather: "Rain, 5°C", crew_count: 8, notes: "Interior work only. Stone saw station set up.", created_by: marc.id },
    { project_id: unit114.id, log_date: isoDate(-1), weather: "Sunny, 11°C", crew_count: 12, notes: "Framing crew at 60%. Steel delivery on schedule.", created_by: marc.id },
  ]);
  await db.insert(schema.rfis).values([
    { project_id: lobby.id, number: "RFI-001", title: "Floor transition at elevator lobby", description: "Confirm threshold height with architect.", status: "submitted", assigned_to: marc.id, due_date: isoDate(4) },
    { project_id: unit114.id, number: "RFI-001", title: "Sprinkler head layout conflict", description: "Head conflicts with new beam.", status: "approved", assigned_to: marc.id, due_date: isoDate(-3) },
  ]);
  await db.insert(schema.change_orders).values([
    { project_id: lobby.id, number: "CO-001", title: "Extra lighting in reception", description: "Owner request.", amount: 6400, status: "approved" },
    { project_id: unit114.id, number: "CO-001", title: "Additional blocking for signage", description: null, amount: 2150, status: "submitted" },
  ]);

  // ---- billing ----
  const yy = new Date().getFullYear().toString().slice(-2);
  const linesA: Line[] = [
    { description: "Progress billing 1 — demolition and prep", quantity: 1, unit: "forfait", unit_price: 85000 },
    { description: "Progress billing 1 — lighting and ceiling", quantity: 1, unit: "forfait", unit_price: 92000 },
  ];
  const linesB: Line[] = [{ description: "Progress billing 2 — stone flooring (50%)", quantity: 1, unit: "forfait", unit_price: 64000 }];
  const linesC: Line[] = [
    { description: "Slab and footings", quantity: 1, unit: "forfait", unit_price: 54000 },
    { description: "Structural steel (deposit)", quantity: 1, unit: "forfait", unit_price: 30000 },
  ];
  const linesD: Line[] = [
    { description: "Floor drains and rough plumbing", quantity: 1, unit: "forfait", unit_price: 16800 },
  ];
  const quoteLines: Line[] = [
    { description: "Tenant fit-out, 4th floor — base scope", quantity: 1, unit: "forfait", unit_price: 232000 },
    { description: "Glass meeting-room partitions", quantity: 2, unit: "un", unit_price: 14500 },
  ];
  const quoteLines2: Line[] = [{ description: "Phase 1 construction — Clinique Griffintown", quantity: 1, unit: "forfait", unit_price: 487000 }];

  function doc(
    kind: "invoice" | "quote",
    n: number,
    clientId: number,
    projectId: number | null,
    title: string,
    lines: Line[],
    status: string,
    issuedOffset: number,
    dueOffset: number | null,
  ) {
    const totals = money(lines);
    return {
      client_id: clientId,
      project_id: projectId,
      kind,
      number: `${kind === "invoice" ? "FAC" : "SOU"}-${yy}${String(n).padStart(2, "0")}`,
      title,
      description: null,
      amount: totals.total,
      status,
      issued_on: isoDate(issuedOffset),
      due_on: dueOffset === null ? null : isoDate(dueOffset),
      notes: "Fake demo document.",
      source_quote_id: null,
      line_items: JSON.stringify(lines),
      subtotal: totals.subtotal,
      tax_gst: totals.gst,
      tax_qst: totals.qst,
      po_number: null,
      sent_at: status === "draft" ? null : isoDate(issuedOffset),
      sent_to: null,
      signed_by: null,
      signed_at: null,
      signature: null,
    };
  }
  await db.insert(schema.billing_documents).values([
    doc("invoice", 1, nordique.id, lobby.id, "Tour Sherbrooke — Progress billing 1", linesA, "paid", -50, -20),
    doc("invoice", 2, nordique.id, lobby.id, "Tour Sherbrooke — Progress billing 2", linesB, "sent", -12, 18),
    doc("invoice", 3, laval.id, unit114.id, "Retail unit 114 — Deposit and slab", linesC, "overdue", -55, -25),
    doc("invoice", 4, boulangerie.id, kitchen.id, "Production kitchen — Plumbing rough-in", linesD, "draft", 0, 30),
    doc("quote", 1, nordique.id, peel.id, "Édifice Peel — Fit-out 4th floor", quoteLines, "sent", -6, null),
    doc("quote", 2, clinique.id, clinicProject.id, "Clinique Griffintown — Phase 1", quoteLines2, "draft", -2, null),
  ]);

  await seedQuoteChanges();
  await seedBillingFiles();
  console.info("[demo] Fake local demo data created (dev only, never synced to production).");
}

/** Draws a plain fake quote/invoice PDF so the viewer has something real to show. */
async function fakePdf(input: { kind: "invoice" | "quote"; number: string; client: string; title: string; lines: Line[]; issued: string; due: string | null }) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "letter" });
  const totals = money(input.lines);
  const fmt = (n: number) => n.toLocaleString("fr-CA", { style: "currency", currency: "CAD" });
  pdf.setFillColor(251, 170, 25);
  pdf.rect(0, 0, 216, 8, "F");
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(26);
  pdf.text("FRX CONSTRUCTION", 16, 28);
  pdf.setFontSize(18);
  pdf.text(input.kind === "invoice" ? "FACTURE" : "SOUMISSION", 16, 44);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(11);
  pdf.text(`N° ${input.number}`, 16, 52);
  pdf.text(`Client : ${input.client}`, 16, 60);
  pdf.text(`Projet : ${input.title}`, 16, 67);
  pdf.text(`Date : ${input.issued}${input.due ? `   Échéance : ${input.due}` : ""}`, 16, 74);
  let y = 92;
  pdf.setFont("helvetica", "bold");
  pdf.text("Description", 16, y);
  pdf.text("Montant", 200, y, { align: "right" });
  pdf.setFont("helvetica", "normal");
  for (const line of input.lines) {
    y += 9;
    pdf.text(line.description, 16, y);
    pdf.text(fmt(line.quantity * line.unit_price), 200, y, { align: "right" });
  }
  y += 16;
  pdf.text("Sous-total", 130, y);
  pdf.text(fmt(totals.subtotal), 200, y, { align: "right" });
  y += 8;
  pdf.text("TPS 5 %", 130, y);
  pdf.text(fmt(totals.gst), 200, y, { align: "right" });
  y += 8;
  pdf.text("TVQ 9,975 %", 130, y);
  pdf.text(fmt(totals.qst), 200, y, { align: "right" });
  y += 11;
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.text("TOTAL", 130, y);
  pdf.text(fmt(totals.total), 200, y, { align: "right" });
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.text("Document de démonstration (données fictives).", 16, 262);
  const data = pdf.output("datauristring").split(",")[1] ?? "";
  return { data, size: Math.round((data.length * 3) / 4), totals };
}

/** Fake uploaded invoices/quotes with annexes and open client requests, for the "Gestion de la facturation" module. */
/** Local databases created before "final" and "add-on" existed: mark the Laval demo quote's accepted revision as final. */
async function patchDemoFinal() {
  const all = await db.select().from(schema.billing_files);
  if (all.some((f) => f.is_final === 1 || f.is_addon === 1)) return;
  const roots = all.filter((f) => f.kind === "quote" && !f.parent_id && f.status === "accepted");
  for (const root of roots) {
    const kids = all.filter((f) => f.parent_id === root.id).sort((a, b) => a.id - b.id);
    const firstAccepted = kids.find((k) => k.status === "accepted");
    if (!firstAccepted) continue;
    await db.update(schema.billing_files).set({ is_final: 1 }).where(eq(schema.billing_files.id, firstAccepted.id));
    for (const k of kids.filter((k) => k.id > firstAccepted.id)) {
      await db.update(schema.billing_files).set({ is_addon: 1 }).where(eq(schema.billing_files.id, k.id));
    }
  }
}

/**
 * The project budget now comes from accepted quotes, so every demo job that has invoices needs an accepted quote.
 * Also seeds a private target margin. Safe to run on an existing local database.
 */
async function ensureDemoContracts() {
  const clientRows = await db.select().from(schema.clients);
  const nordique = clientRows.find((c) => c.company_name.includes("Nordique"));
  if (!nordique) return;
  const projectRows = await db.select().from(schema.projects).where(eq(schema.projects.client_id, nordique.id));
  const lobby = projectRows.find((p) => p.name.includes("Lobby"));
  if (!lobby) return;
  const files = await db.select().from(schema.billing_files).where(eq(schema.billing_files.client_id, nordique.id));
  const hasAccepted = files.some((f) => f.kind === "quote" && !f.parent_id && f.project_id === lobby.id && f.status === "accepted");
  if (!hasAccepted) {
    const lines: Line[] = [
      { description: "Rénovation du lobby — démolition, plafond et éclairage", quantity: 1, unit: "forfait", unit_price: 310000 },
      { description: "Revêtement de sol en pierre et ébénisterie", quantity: 1, unit: "forfait", unit_price: 106000 },
    ];
    const pdf = await fakePdf({ kind: "quote", number: "SOU-DEMO-LOBBY", client: nordique.company_name, title: lobby.name, lines, issued: isoDate(-80), due: null });
    const [marc] = await db.select().from(schema.users).where(eq(schema.users.email, "marc@frxconstruction.ca"));
    const [row] = await db
      .insert(schema.billing_files)
      .values({
        kind: "quote",
        client_id: nordique.id,
        project_id: lobby.id,
        number: "SOU-DEMO-LOBBY",
        title: "Tour Sherbrooke — Lobby, contrat accepté",
        subtotal: pdf.totals.subtotal,
        tax_gst: pdf.totals.gst,
        tax_qst: pdf.totals.qst,
        amount: pdf.totals.total,
        issued_on: isoDate(-80),
        status: "accepted",
        published: 1,
        is_final: 1,
        file_name: "SOU-DEMO-LOBBY.pdf",
        file_type: "application/pdf",
        file_size: pdf.size,
        ai_status: "analyzed",
        accepted_by: "Sophie Gagnon",
        accepted_at: new Date().toISOString(),
        uploaded_by: marc?.id ?? null,
      })
      .returning();
    await db.insert(schema.billing_file_blobs).values({ file_id: row.id, data: pdf.data });
  }
  const targets = await db.select().from(schema.project_finance).where(eq(schema.project_finance.project_id, lobby.id));
  if (targets.length === 0) {
    await db.insert(schema.project_finance).values({ project_id: lobby.id, target_margin_pct: 30, planned_cost: 300000 });
  } else if (targets[0].planned_cost === null) {
    await db.update(schema.project_finance).set({ planned_cost: 300000 }).where(eq(schema.project_finance.id, targets[0].id));
  }
  // Private real costs: supplier invoices and one quick entry (before taxes).
  const costs = await db.select({ id: schema.project_costs.id }).from(schema.project_costs).where(eq(schema.project_costs.project_id, lobby.id));
  if (costs.length === 0) {
    await db.insert(schema.project_costs).values([
      { project_id: lobby.id, source: "invoice", supplier: "Béton Laurentides inc.", description: "Facture 4471 — dalle et nivellement", incurred_on: isoDate(-55), amount: 38000, paid: 1 },
      { project_id: lobby.id, source: "invoice", supplier: "Éclairage Lux inc.", description: "Facture 2209 — luminaires et contrôles", incurred_on: isoDate(-32), amount: 105300, paid: 1 },
      { project_id: lobby.id, source: "invoice", supplier: "Menuiserie Nordik", description: "Facture 880 — ébénisterie, acompte", incurred_on: isoDate(-9), amount: 40000, paid: 0 },
      { project_id: lobby.id, source: "quick", supplier: null, description: "Main-d’œuvre de chantier à ce jour", incurred_on: isoDate(-2), amount: 29200, paid: 1 },
    ]);
  }
}

async function seedBillingFiles() {
  const have = await db.select({ id: schema.billing_files.id }).from(schema.billing_files).limit(1);
  if (have.length > 0) {
    await patchDemoFinal();
    await ensureDemoContracts();
    return;
  }
  const clientRows = await db.select().from(schema.clients);
  const byName = (needle: string) => clientRows.find((c) => c.company_name.includes(needle));
  const nordique = byName("Nordique");
  const laval = byName("Laval");
  const boulangerie = byName("Boulangerie");
  if (!nordique || !laval || !boulangerie) return;
  const projectRows = await db.select().from(schema.projects);
  const projectOf = (clientId: number, needle: string) => projectRows.find((p) => p.client_id === clientId && p.name.includes(needle));
  const [sophie] = await db.select().from(schema.users).where(eq(schema.users.email, "sophie@nordique.com"));
  const [marc] = await db.select().from(schema.users).where(eq(schema.users.email, "marc@frxconstruction.ca"));
  const yy = new Date().getFullYear().toString().slice(-2);

  type Spec = {
    kind: "invoice" | "quote";
    number: string;
    client: typeof nordique;
    projectNeedle?: string;
    title: string;
    lines: Line[];
    issuedOffset: number;
    dueOffset: number | null;
    status: string;
    parentId?: number | null;
    requestId?: number | null;
    acceptedBy?: string | null;
    staffSeen?: number;
    isFinal?: boolean;
    isAddon?: boolean;
  };
  async function add(spec: Spec) {
    const issued = isoDate(spec.issuedOffset);
    const due = spec.dueOffset === null ? null : isoDate(spec.dueOffset);
    const pdf = await fakePdf({ kind: spec.kind, number: spec.number, client: spec.client.company_name, title: spec.title, lines: spec.lines, issued, due });
    const project = spec.projectNeedle ? projectOf(spec.client.id, spec.projectNeedle) : undefined;
    const [row] = await db
      .insert(schema.billing_files)
      .values({
        kind: spec.kind,
        client_id: spec.client.id,
        project_id: project?.id ?? null,
        parent_id: spec.parentId ?? null,
        request_id: spec.requestId ?? null,
        number: spec.number,
        title: spec.title,
        description: null,
        subtotal: pdf.totals.subtotal,
        tax_gst: pdf.totals.gst,
        tax_qst: pdf.totals.qst,
        amount: pdf.totals.total,
        issued_on: issued,
        due_on: due,
        status: spec.status,
        published: 1,
        file_name: `${spec.number}.pdf`,
        file_type: "application/pdf",
        file_size: pdf.size,
        ai_status: "analyzed",
        ai_notes: JSON.stringify({ confidence: "high", client_name: spec.client.company_name }),
        uploaded_by: marc?.id ?? null,
        accepted_by: spec.acceptedBy ?? null,
        accepted_at: spec.acceptedBy ? new Date().toISOString() : null,
        staff_seen: spec.staffSeen ?? 1,
        is_final: spec.isFinal ? 1 : 0,
        is_addon: spec.isAddon ? 1 : 0,
      })
      .returning();
    await db.insert(schema.billing_file_blobs).values({ file_id: row.id, data: pdf.data });
    return row;
  }

  // Invoices
  await add({ kind: "invoice", number: `FAC-${yy}01`, client: nordique, projectNeedle: "Lobby", title: "Tour Sherbrooke — Facturation progressive 1", lines: [{ description: "Démolition et préparation", quantity: 1, unit: "forfait", unit_price: 85000 }, { description: "Éclairage et plafond", quantity: 1, unit: "forfait", unit_price: 92000 }], issuedOffset: -50, dueOffset: -20, status: "paid" });
  await add({ kind: "invoice", number: `FAC-${yy}02`, client: nordique, projectNeedle: "Lobby", title: "Tour Sherbrooke — Facturation progressive 2", lines: [{ description: "Revêtement de sol en pierre (50 %)", quantity: 1, unit: "forfait", unit_price: 64000 }], issuedOffset: -12, dueOffset: 18, status: "sent" });
  await add({ kind: "invoice", number: `FAC-${yy}03`, client: laval, projectNeedle: "unit 114", title: "Unité 114 — Dalle et fondations", lines: [{ description: "Dalle et semelles", quantity: 1, unit: "forfait", unit_price: 54000 }, { description: "Acompte acier de structure", quantity: 1, unit: "forfait", unit_price: 30000 }], issuedOffset: -55, dueOffset: -25, status: "sent" });
  await add({ kind: "invoice", number: `FAC-${yy}04`, client: boulangerie, projectNeedle: "kitchen", title: "Cuisine de production — Plomberie", lines: [{ description: "Drains de plancher et plomberie brute", quantity: 1, unit: "forfait", unit_price: 16800 }], issuedOffset: -3, dueOffset: 27, status: "sent" });

  // Quotes
  const peel = await add({ kind: "quote", number: `SOU-${yy}01`, client: nordique, projectNeedle: "Peel", title: "Édifice Peel — Aménagement 4e étage", lines: [{ description: "Aménagement locatif, étage 4 — base", quantity: 1, unit: "forfait", unit_price: 232000 }, { description: "Cloisons vitrées de salles de réunion", quantity: 2, unit: "un", unit_price: 14500 }], issuedOffset: -6, dueOffset: null, status: "sent" });
  const retail = await add({ kind: "quote", number: `SOU-${yy}02`, client: laval, projectNeedle: "unit 114", title: "Centre Carrefour — Unité 114, aménagement", lines: [{ description: "Aménagement complet de l’unité 114", quantity: 1, unit: "forfait", unit_price: 118000 }], issuedOffset: -45, dueOffset: null, status: "accepted", acceptedBy: "Daniel Roy" });

  // Annexes (sub-files of a quote) and client requests
  const [peelRequest] = await db
    .insert(schema.billing_requests)
    .values({
      file_id: peel.id,
      client_id: nordique.id,
      number: `DC-SOU-${yy}01-01`,
      title: "Ajouter une porte vitrée à la salle 2",
      description: "Pourrait-on remplacer la porte pleine de la salle de réunion 2 par une porte vitrée à cadre noir?",
      status: "answered",
      requested_by: sophie?.id ?? null,
      requested_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      staff_seen: 1,
    })
    .returning();
  await add({ kind: "quote", number: `SOU-${yy}01-1`, client: nordique, projectNeedle: "Peel", title: "Modification — porte vitrée salle 2", lines: [{ description: "Porte vitrée à cadre noir, fournie et installée", quantity: 1, unit: "un", unit_price: 3200 }], issuedOffset: -1, dueOffset: null, status: "sent", parentId: peel.id, requestId: peelRequest.id });
  await add({ kind: "quote", number: `SOU-${yy}02-1`, client: laval, projectNeedle: "unit 114", title: "Centre Carrefour — Unité 114, version révisée", lines: [{ description: "Aménagement complet de l’unité 114", quantity: 1, unit: "forfait", unit_price: 118000 }, { description: "Enseigne lumineuse DEL et alimentation", quantity: 1, unit: "forfait", unit_price: 6400 }], issuedOffset: -20, dueOffset: null, status: "accepted", parentId: retail.id, acceptedBy: "Daniel Roy", isFinal: true });
  await add({ kind: "quote", number: `SOU-${yy}02-A1`, client: laval, projectNeedle: "unit 114", title: "Ajout — prises électriques supplémentaires", lines: [{ description: "Six prises électriques et circuit dédié pour la caisse", quantity: 1, unit: "forfait", unit_price: 2400 }], issuedOffset: -5, dueOffset: null, status: "accepted", parentId: retail.id, acceptedBy: "Daniel Roy", isAddon: true });
  await add({ kind: "quote", number: `SOU-${yy}02-A2`, client: laval, projectNeedle: "unit 114", title: "Ajout — climatisation de la réserve", lines: [{ description: "Unité murale de climatisation, réserve", quantity: 1, unit: "forfait", unit_price: 3800 }], issuedOffset: -1, dueOffset: null, status: "sent", parentId: retail.id, isAddon: true });
  await db.insert(schema.billing_requests).values({
    file_id: retail.id,
    client_id: laval.id,
    number: `DC-SOU-${yy}02-01`,
    title: "Prises électriques supplémentaires",
    description: "Nous aimerions six prises de plus le long du mur est, ainsi qu’un circuit dédié pour la caisse.",
    status: "open",
    requested_by: null,
    requested_at: new Date().toISOString(),
    staff_seen: 0,
  });
  await ensureDemoContracts();
}

/** Sample change requests on the first demo quote: one waiting for pricing, one annex waiting for the client. */
async function seedQuoteChanges() {
  const have = await db.select({ id: schema.quote_changes.id }).from(schema.quote_changes).limit(1);
  if (have.length > 0) return;
  const quotes = await db.select().from(schema.billing_documents).where(eq(schema.billing_documents.kind, "quote"));
  const quote = quotes.sort((a, b) => a.id - b.id)[0];
  if (!quote) return;
  const [sophie] = await db.select().from(schema.users).where(eq(schema.users.email, "sophie@nordique.com"));
  const [marc] = await db.select().from(schema.users).where(eq(schema.users.email, "marc@frxconstruction.ca"));
  const addOn: Line[] = [
    { description: "Additional electrical outlets (4 locations)", quantity: 4, unit: "un", unit_price: 285 },
    { description: "Data cabling for meeting room", quantity: 1, unit: "forfait", unit_price: 1650 },
  ];
  const totals = money(addOn);
  await db.insert(schema.quote_changes).values([
    {
      quote_id: quote.id,
      client_id: quote.client_id,
      number: `DC-${quote.number}-01`,
      origin: "client",
      status: "requested",
      title: "Add glass door to meeting room 2",
      description: "Fake demo request. Could we replace the solid door of meeting room 2 with a glass door, black frame?",
      amount: 0,
      requested_by: sophie?.id ?? null,
      requested_at: new Date().toISOString(),
      staff_seen: 0,
    },
    {
      quote_id: quote.id,
      client_id: quote.client_id,
      number: `DC-${quote.number}-02`,
      origin: "staff",
      status: "proposed",
      title: "Extra outlets and data cabling",
      description: "Fake demo annex. Prices include installation.",
      line_items: JSON.stringify(addOn),
      subtotal: totals.subtotal,
      tax_gst: totals.gst,
      tax_qst: totals.qst,
      amount: totals.total,
      proposed_by: marc?.id ?? null,
      proposed_at: new Date().toISOString(),
      staff_seen: 1,
    },
  ]);
}
