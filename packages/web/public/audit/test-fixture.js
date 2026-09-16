// NON-FUNCTIONAL TEST FIXTURE. The token below is fake: it decodes to
// role=service_role but points at a project that does not exist and has an
// invalid signature. It exists only to give the scanner something to find so the
// full scan -> pay -> unlock flow can be tested. Safe to delete.
const SUPABASE_SERVICE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwicmVmIjoiZmFrZXRlc3Rwcm9qMDAwMDAwIiwiaXNzIjoic3VwYWJhc2UiLCJub3RlIjoiVEhJUyBJUyBBIE5PTi1GVU5DVElPTkFMIFRFU1QgVE9LRU4ifQ.THIS_IS_NOT_A_REAL_SIGNATURE_test";
console.log("test fixture loaded", SUPABASE_SERVICE_KEY.slice(0, 8));
