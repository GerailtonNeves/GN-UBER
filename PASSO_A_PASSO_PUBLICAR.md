# 🚀 COMO PUBLICAR SEU APLICATIVO UBER NO GITHUB, VERCEL E RENDER (100% GRÁTIS)

Esta pasta contém **TODOS** os arquivos necessários para colocar o seu aplicativo no ar na internet.

---

## 📂 Arquivos Incluídos Nesta Pasta:

* 📂 **`frontend/`**: Todo o código da interface visual do aplicativo (Passageiro, Motorista e Admin).
* 📂 **`backend/`**: Servidor Node.js + Socket.io em tempo real com algoritmo do motorista mais próximo, sirene de 5s, cálculo de tarifas e banco JSON.
* 📄 **`vercel.json`**: Arquivo de configuração pré-pronto para publicação automática de 1 clique na Vercel.
* 📄 **`.gitignore`**: Arquivo de proteção do repositório.

---

## ⚡ Passo 1: Subir a Pasta para o GitHub

1. Acesse **[github.com](https://github.com)** e crie um repositório chamado `meu-app-uber`.
2. Abra o Terminal na sua máquina e digite:

```bash
cd C:\Users\Gerailton\Desktop\PROJETO_UBER_GITHUB
git init
git add .
git commit -m "Publicação Inicial App Uber v3.0"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/meu-app-uber.git
git push -u origin main
```

---

## ⚙️ Passo 2: Publicar o Backend no Render.com (Gratuito)

1. Acesse **[render.com](https://render.com)** e crie uma conta gratuita.
2. Clique em **"New +"** -> **"Web Service"** e conecte seu repositório `meu-app-uber`.
3. Preencha:
   - **Root Directory:** `backend`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Clique em **Create Web Service**. Ele criará seu link público do servidor (ex: `https://meu-uber-backend.onrender.com`).

---

## 🌐 Passo 3: Publicar o Frontend na Vercel (Gratuito)

1. Acesse **[vercel.com](https://vercel.com)** e faça login com o GitHub.
2. Clique em **"Add New..."** -> **"Project"**.
3. Importe o repositório `meu-app-uber`.
4. Em **Root Directory**, escolha a pasta `frontend`.
5. Clique em **Deploy**.

PRONTO! Seu aplicativo estará 100% online no mundo todo em menos de 1 minuto!
