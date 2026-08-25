<img width="512" height="512" alt="Icon 1" src="https://github.com/user-attachments/assets/8bf5448a-66a3-4e95-a658-b9dd2c7dca71" />

# SpotOn

**SpotOn** is a peer-to-peer parking marketplace designed to alleviate the daily frustrations of campus parking. By connecting students, residents, and local businesses with drivers in need of a spot, we turn underutilized spaces into a shared community resource.

## 🌟 Project Vision
> For students who struggle to find affordable, reliable parking in Gainesville, the SpotOn is a peer-to-peer parking marketplace that allows users to reserve private driveways and local spots in advance for much less than commercial garages. Unlike SpotHero or ParkMobile, our product provides access to hidden inventory in residential areas, making parking more accessible and community-driven.

---

## 🛠 Tech Stack
* **Frontend:** [React Native](https://reactnative.dev/) with [Expo](https://expo.dev/) (TypeScript)
* **Backend:** [Flask](https://flask.palletsprojects.com/) (Python)
* **Database:** [Supabase](https://supabase.com/) (SQL)
* **Design:** [Figma Board](https://www.figma.com/design/jhOFiSLhLxZJhtdv2zpfOB/SpotOn-Board?node-id=0-1&p=f&t=67c62KVDqOPUEi95-0)

---

## 👥 The Team
| Name | Role | Responsibility |
| :--- | :--- | :--- |
| **Ehan Shah** | Product Owner & Full Stack | Backlog grooming, UI/UX, & API integration. |
| **Shivank Joginipalli** | Full Stack Engineer | Frontend development & state management. |
| **Diego Rodriguez** | Backend Engineer | Server-side logic, Database schema, & Security. |
| **Adrian Estevez** | Scrum Master | Sprint management & process optimization. |

---

## 🚀 Solution Overview
Campus parking is one of the biggest daily frustrations for college students. SpotOn allows spot owners (students with unused permits, nearby residents, or local businesses) to list available parking spaces for others to book for flexible time windows.
* **Browse & Reserve:** Find and book spots near campus in real-time.
* **List & Earn:** Monetize underutilized driveways or permits.
* **Secure Marketplace:** Turning private spaces into a shared resource.

---

## 📂 Getting Started

1. **Clone the repo:**
```bash
git clone https://github.com/Drodr10/SpotOn.git
```

> **Python 3.12+ required.** `notifications.py` and `payouts.py` use `str | None`
> annotations (PEP 604), which are evaluated at import time — on an older
> interpreter the Flask app fails to start with
> `TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'`, which
> does not obviously mean "wrong Python version". macOS ships 3.9 as the system
> `python3`, so `python3 -m venv .venv` on a stock Mac will NOT work. Use a
> newer interpreter explicitly:
>
> ```bash
> brew install python@3.12          # or pyenv install 3.12
> python3.12 -m venv backend/.venv
> ```
>
> The pinned version lives in `.python-version` (read by pyenv and by CI).

2. **Frontend Setup:**
```bash
cd frontend
npm install
npx expo start
```

3. **Backend Setup:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

4. **Ngrok Setup** (for testing on a physical device):

   1. Install ngrok (if not already):
   ```bash
   brew install ngrok
   ```

   2. Authenticate (one-time, if you haven't):

      Go to [ngrok.com](https://ngrok.com), sign in, and grab your auth token from the dashboard. Then:
   ```bash
   ngrok config add-authtoken YOUR_TOKEN_HERE
   ```

   3. Start your Flask backend:
   ```bash
   cd backend
   python app.py
   ```

   4. In a second terminal, start ngrok pointing at port 5000:
   ```bash
   ngrok http 5000
   ```

      You'll see output like:
   ```
   Forwarding   https://abc123.ngrok-free.app -> http://localhost:5000
   ```

   5. Copy that ngrok URL and put it in your `.env`:

      Open `frontend/.env` and add/update:
   ```
   EXPO_PUBLIC_IP=abc123.ngrok-free.app
   ```

      Note: your code already builds the URL as `https://${EXPO_PUBLIC_IP}/api` — so just paste the hostname without `https://` and without a trailing slash.

   6. Restart Expo (important — env vars are baked in at start):
   ```bash
   cd frontend
   npx expo start --clear
   ```

      Scan the QR code with Expo Go on your phone and it'll work.


