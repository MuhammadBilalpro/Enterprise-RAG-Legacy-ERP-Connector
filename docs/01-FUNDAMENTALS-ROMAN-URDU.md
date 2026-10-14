# Fundamentals — Roman Urdu mein

## 1. Hum kis problem ko solve kar rahe hain?

Socho company ki invoice PDF mein hai, payment status purane ERP database mein hai, aur delivery delay ki discussion Slack par hai. Employee ko ek jawab ke liye teen jagah dekhna parta hai. Hum in sources ko ek searchable workspace mein laate hain, lekin har employee ko har document ki ijazat nahi dete.

Example: `Acme overdue invoice` search karne par finance employee ko invoice aur relevant Slack discussion mil sakti hai. General employee ko finance documents nahi milte. Usko company handbook mil sakta hai.

## 2. Frontend, backend aur database

**Frontend** browser mein nazar aane wala dashboard hai. Form, buttons, source cards aur results yahin hain. Files: `public/index.html`, `public/style.css`, `public/app.js`.

**Backend** rules enforce karta hai: password sahi hai? User ka role kya hai? Upload valid hai? Review ki permission hai? File: `src/server.js`.

**Database** durable storage hai. App band karke dobara kholne par documents aur tasks isi ki wajah se rehte hain. Hum SQLite use karte hain: SQL database ek file mein. Yeh small prototype ke liye simple hai. High concurrency aur multiple app instances ke liye PostgreSQL aur shared services evaluate karenge.

Browser par button hide karna security nahi. User API directly call kar sakta hai. Is liye backend par checks zaroori hain.

## 3. API kya hai?

API frontend aur backend ka agreed contract hai. Browser `POST /api/ask` par `{ "query": "overdue invoice" }` bhejta hai. Backend authenticated user ke allowed sources search karke JSON response deta hai.

GET data read karta hai. POST login, ingestion, search request ya action create karta hai. DELETE document remove karta hai. HTTP 401 ka matlab login required; 403 ka matlab permission nahi; 400 ka matlab request mein problem.

## 4. Ingestion pipeline

Ingestion ka matlab external data ko apne system ke usable format mein lana.

1. **Extract:** PDF ke text layer se text nikalo; Slack JSON se messages; SQL rows se invoice fields.
2. **Normalize:** extra spaces, unusual Unicode representations aur control characters clean karo.
3. **Attach metadata:** title, source type, access role aur source ID ke baghair text ka context kho jata hai.
4. **Chunk:** text ko chhote overlapping pieces mein divide karo.
5. **Store:** document metadata aur chunks database mein save karo.

Hum cleaning mein accounting meaning guess nahi karte. `1,200` ko automatically amount samajh kar convert nahi karte, kyunki locales different ho sakte hain. Scanned image PDFs ke liye OCR alag stage chahiye; abhi clear error milta hai.

## 5. Chunking aur overlap

Poori 100-page file model ko dena expensive aur noisy ho sakta hai. Hum 1,100 characters ke chunks aur 180 characters overlap use karte hain. Agla chunk pichle chunk ke end se kuch content repeat karta hai taake boundary par context kam lose ho.

Yeh character-based approach hai, token-based ya section-aware nahi. Table ki row cut ho sakti hai. Production mein headings, tables, page boundaries aur model token budget consider karenge.

## 6. Retrieval kya hai? BM25 kya karta hai?

Retrieval ka matlab question ke liye relevant passages dhoondhna. Hum query ko words mein tokenize karte hain. BM25 rare matching words ko zyada weight deta hai, repeated words ka benefit dheere dheere limit karta hai, aur document length account karta hai.

`Acme overdue invoice` exact terms wali invoice ko rank karega. `late bill` zaroori nahi `overdue invoice` match kare. BM25 lexical hai: words match karta hai, full meaning nahi samajhta. Score probability ya confidence percentage nahi hota.

Semantic search embeddings use karti hai: text ko numbers ke vector mein represent karke meaning similarity compare ki jati hai. Humne embeddings abhi implement nahi kiye. Hybrid search lexical aur semantic results combine kar sakti hai.

## 7. RAG ka full matlab

**Retrieval-Augmented Generation:** pehle relevant evidence retrieve karo, phir language model ko question ke saath woh evidence do, phir evidence-based jawab generate karwao.

Atlas ka default mode retrieval aur excerpts show karta hai. Yeh generative AI answer nahi hai. Optional Ollama configure karne par generation stage activate hoti hai aur system full RAG flow chalata hai. Model train ya fine-tune nahi hota; context request ke waqt diya jata hai.

Citations se user source check kar sakta hai. Citation dikhna apne aap correctness ka proof nahi. Model galat conclusion ya unsupported citation likh sakta hai; underlying excerpt inspect karna zaroori hai.

## 8. Authentication vs authorization

**Authentication:** tum kaun ho? Username/password check karne ke baad session milta hai.

**Authorization:** tum kya dekh aur kar sakte ho? Backend stored role ke mutabiq permission decide karta hai.

Password plain text store nahi hota. Random salt aur scrypt se password hash store hota hai. Hash reversible encryption nahi. Login par entered password ka hash compare hota hai. Session token random secret hota hai; database mein uska SHA-256 hash save hota hai. Browser cookie HttpOnly hai, is liye normal frontend JavaScript usko read nahi kar sakti.

## 9. RBAC ka important design

| Role | Employee sources | Finance sources | Admin sources | Ingest/delete | Request review |
|---|---|---|---|---|---|
| employee | Yes | No | No | No | No |
| finance | Yes | Yes | No | No | Yes, visible PDF/ERP only |
| admin | Yes | Yes | Yes | Yes | Yes |

Search ke SQL query mein hi role filter lagta hai. Restricted chunks ranking ya model prompt tak nahi jate. Agar pehle model ko saara data bhej diya aur baad mein browser se hide kiya, data leak pehle hi ho chuka hoga.

Yeh simple role hierarchy hai. Real company mein departments, teams, individual document sharing aur tenant isolation bhi chahiye ho sakti hai.

## 10. Agent aur action ka farq

Chatbot sirf jawab deta hai. Agent workflow kisi tool/action ko invoke kar sakta hai. Is project mein bounded workflow hai: evidence dekho → invoice review request confirm karo → backend permission check kare → pending task create ho.

Yeh autonomous planning agent nahi. Model khud tools select nahi karta aur payment approve nahi karta. Tool endpoint deterministic rules follow karta hai. Ek document par repeat clicks se duplicate review tasks nahi bante; database UNIQUE constraint isko enforce karta hai. Is property ko idempotency kehte hain.

## 11. Transactions, foreign keys aur prepared queries

Transaction changes ko ek unit banati hai. Document save ho gaya lekin chunks fail ho gaye to incomplete state nahi chahiye. BEGIN/COMMIT successful operation save karte hain; ROLLBACK failure par changes undo karta hai.

Foreign key chunks ko unke document se relate karti hai. ON DELETE CASCADE document delete hone par linked chunks/tasks delete karti hai.

Prepared statement mein user values placeholders se pass hoti hain. User input ko SQL code bana kar concatenate nahi karte. Is se SQL injection ka risk address hota hai. ERP connector user ya model ki arbitrary SQL execute hi nahi karta.

## 12. Docker kya solve karta hai?

Docker image app code, Node runtime aur dependencies ka packaged environment hai. Container us image ka running instance. Volume persistent data rakhta hai. Compose build, port, environment aur volume ko ek configuration mein describe karta hai.

Docker server ko automatically secure, highly available ya GDPR-compliant nahi banata. Deployment reproducible hota hai; operations aur policy ka kaam phir bhi hota hai.

## Apne aap ko check karo

1. Frontend mein admin button hide karna kaafi kyun nahi?
2. Model ko context dene se pehle ACL filter kyun lagta hai?
3. Hash aur encryption ka difference kya hai?
4. Duplicate upload aur updated invoice mein kya difference hai?
5. Search score ko confidence percentage kehna kyun galat hai?
6. Default evidence mode ko full generative RAG kehna kyun inaccurate hai?
