# UangKu

Frontend mobile-first untuk ledger keuangan keluarga yang memakai Supabase project `gene`.

## Fitur awal

- Login dengan Supabase Auth yang sama dengan aplikasi Orderan.
- Dashboard saldo profil dan total keluarga.
- Ringkasan pemasukan dan pengeluaran bulanan.
- Filter transaksi berdasarkan sumber `Orderan` atau `UangKu`.
- Input transaksi manual: pendapatan, pengeluaran, dan transfer internal.
- Pemilihan profil keluarga.
- Data Orderan dibaca dari `finance_transactions` hasil sinkronisasi trigger database.

## Struktur data utama

- `finance_households`
- `finance_profiles`
- `finance_accounts`
- `finance_categories`
- `finance_transactions`
- `finance_reimbursement_items`

Hanya transaksi dengan `status = posted` yang dihitung. Transfer internal tidak menambah pemasukan atau pengeluaran keluarga.

## Deploy

Repository berupa aplikasi HTML statis dan dapat langsung dihubungkan ke Vercel tanpa build command.