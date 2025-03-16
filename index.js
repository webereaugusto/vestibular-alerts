require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');

const app = express();
const port = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seu_segredo_jwt';

// Configurar o Mercado Pago com a nova API
const client = new MercadoPagoConfig({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN,
    options: { timeout: 5000 }
});

const preference = new Preference(client);
const paymentClient = new Payment(client);

// Configurar o transportador de e-mail
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

// Função para enviar e-mail
const sendAlertEmail = async (to, subject, text) => {
    const mailOptions = {
        from: process.env.EMAIL_USER,
        to: to,
        subject: subject,
        text: text
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log(`E-mail enviado para ${to} com sucesso!`);
    } catch (error) {
        console.error('Erro ao enviar e-mail:', error.message);
    }
};

// Configurar o Express para usar JSON no corpo das requisições
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configurar o SQLite
const db = new sqlite3.Database('vestibular_alerts.db', (err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', err.message);
    } else {
        console.log('Conectado ao banco de dados SQLite.');
    }
});

// Criar a tabela `users`
db.run(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        whatsapp_number TEXT NOT NULL,
        password TEXT NOT NULL,
        plan_id INTEGER DEFAULT 1, -- 1 = Grátis (padrão)
        FOREIGN KEY (plan_id) REFERENCES plans(id)
    )
`);

// Criar a tabela `plans`
db.run(`
    CREATE TABLE IF NOT EXISTS plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        limit_vestibulares INTEGER NOT NULL,
        price REAL
    )
`);

// Inserir planos de exemplo
db.run(`
    INSERT OR IGNORE INTO plans (name, limit_vestibulares, price)
    VALUES ('Grátis', 2, 0.0), ('Intermediário', 6, 9.99), ('Premium', -1, 19.99)
`);

// Criar a tabela `vestibulares`
db.run(`
    CREATE TABLE IF NOT EXISTS vestibulares (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        institution TEXT NOT NULL,
        start_registration DATE,
        end_registration DATE,
        payment_deadline DATE,
        exemption_deadline DATE,
        first_phase_date DATE,
        second_phase_date DATE,
        results_date DATE,
        first_call_date DATE,
        enrollment_date DATE,
        second_call_date DATE
    )
`);

// Inserir vestibulares de exemplo
db.run(`
    INSERT OR IGNORE INTO vestibulares (name, institution, start_registration, end_registration, payment_deadline, exemption_deadline, first_phase_date, second_phase_date, results_date, first_call_date, enrollment_date, second_call_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
    'ENEM 2025', 'MEC', '2025-05-01', '2025-06-01', '2025-06-05', '2025-04-15', '2025-11-02', '2025-11-09', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01'
]);

db.run(`
    INSERT OR IGNORE INTO vestibulares (name, institution, start_registration, end_registration, payment_deadline, exemption_deadline, first_phase_date, second_phase_date, results_date, first_call_date, enrollment_date, second_call_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
    'Fuvest 2025', 'USP', '2025-04-15', '2025-05-15', '2025-05-20', '2025-04-10', '2025-11-20', '2025-12-15', '2026-01-20', '2026-02-05', '2026-02-20', '2026-03-05'
]);

db.run(`
    INSERT OR IGNORE INTO vestibulares (name, institution, start_registration, end_registration, payment_deadline, exemption_deadline, first_phase_date, second_phase_date, results_date, first_call_date, enrollment_date, second_call_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
    'Unicamp 2025', 'Unicamp', '2025-05-10', '2025-06-10', '2025-06-15', '2025-05-05', '2025-11-25', '2025-12-18', '2026-01-25', '2026-02-10', '2026-02-25', '2026-03-10'
]);

// Criar a tabela `user_vestibulares`
db.run(`
    CREATE TABLE IF NOT EXISTS user_vestibulares (
        user_id INTEGER,
        vestibular_id INTEGER,
        PRIMARY KEY (user_id, vestibular_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vestibular_id) REFERENCES vestibulares(id)
    )
`);

// Middleware para verificar o token JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const headerToken = authHeader && authHeader.split(' ')[1];
    const queryToken = req.query.token;
    const token = headerToken || queryToken;

    if (!token) return res.status(401).json({ error: 'Token não fornecido' });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: 'Token inválido' });
        req.user = user;
        next();
    });
};

// Rota inicial
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

// Rota para a dashboard (sem proteção para o HTML)
app.get('/dashboard', (req, res) => {
    res.sendFile(__dirname + '/public/dashboard.html');
});

// Rota para autenticar o acesso à dashboard (protegida)
app.post('/auth/dashboard', authenticateToken, (req, res) => {
    res.status(200).json({ message: 'Autenticado com sucesso' });
});

// Rota para cadastrar um novo usuário
app.post('/register', async (req, res) => {
    const { name, email, whatsapp_number, password } = req.body;

    if (!name || !email || !whatsapp_number || !password) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (name, email, whatsapp_number, password) VALUES (?, ?, ?, ?)';
        db.run(query, [name, email, whatsapp_number, hashedPassword], function (err) {
            if (err) {
                return res.status(500).json({ error: 'Erro ao cadastrar usuário: ' + err.message });
            }
            const token = jwt.sign({ userId: this.lastID, email }, JWT_SECRET, { expiresIn: '24h' });
            res.status(201).json({ 
                message: 'Usuário cadastrado com sucesso!', 
                userId: this.lastID,
                token
            });
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao processar requisição: ' + error.message });
    }
});

// Rota para login
app.post('/login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar usuário: ' + err.message });
        }

        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        try {
            const match = await bcrypt.compare(password, user.password);
            if (!match) {
                return res.status(401).json({ error: 'Credenciais inválidas.' });
            }
            const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });
            res.json({ 
                message: 'Login realizado com sucesso!',
                userId: user.id,
                name: user.name,
                token
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao processar requisição: ' + error.message });
        }
    });
});

// Rota para listar todos os usuários (protegida)
app.get('/users', authenticateToken, (req, res) => {
    db.all('SELECT id, name, email, whatsapp_number FROM users', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar usuários: ' + err.message });
        }
        res.json(rows);
    });
});

// Rota para obter os dados do usuário autenticado
app.get('/user', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    db.get('SELECT name, email, whatsapp_number FROM users WHERE id = ?', [userId], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar usuário: ' + err.message });
        }
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        res.json(user);
    });
});

// Rota para listar todos os vestibulares
app.get('/vestibulares', (req, res) => {
    db.all('SELECT * FROM vestibulares', [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar vestibulares: ' + err.message });
        }
        res.json(rows);
    });
});

// Rota para adicionar um vestibular à lista do usuário
app.post('/user/vestibulares', authenticateToken, (req, res) => {
    const { vestibular_id } = req.body;
    const user_id = req.user.userId;

    if (!vestibular_id) {
        return res.status(400).json({ error: 'ID do vestibular é obrigatório.' });
    }

    db.get('SELECT id FROM vestibulares WHERE id = ?', [vestibular_id], (err, vestibular) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao verificar vestibular: ' + err.message });
        }
        if (!vestibular) {
            return res.status(404).json({ error: 'Vestibular não encontrado.' });
        }

        db.get('SELECT p.limit_vestibulares FROM users u JOIN plans p ON u.plan_id = p.id WHERE u.id = ?', [user_id], (err, plan) => {
            if (err) {
                return res.status(500).json({ error: 'Erro ao verificar plano: ' + err.message });
            }

            db.all('SELECT COUNT(*) as count FROM user_vestibulares WHERE user_id = ?', [user_id], (err, rows) => {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao contar vestibulares: ' + err.message });
                }
                const currentCount = rows[0].count;

                if (plan.limit_vestibulares !== -1 && currentCount >= plan.limit_vestibulares) {
                    return res.status(403).json({ error: `Limite de ${plan.limit_vestibulares} vestibulares atingido. Assine um plano superior.` });
                }

                const query = 'INSERT OR IGNORE INTO user_vestibulares (user_id, vestibular_id) VALUES (?, ?)';
                db.run(query, [user_id, vestibular_id], function (err) {
                    if (err) {
                        return res.status(500).json({ error: 'Erro ao adicionar vestibular: ' + err.message });
                    }
                    if (this.changes === 0) {
                        return res.status(200).json({ message: 'Vestibular já está na sua lista.' });
                    }
                    res.status(201).json({ message: 'Vestibular adicionado com sucesso!' });
                });
            });
        });
    });
});

// Rota para remover um vestibular da lista do usuário
app.delete('/user/vestibulares/:id', authenticateToken, (req, res) => {
    const vestibular_id = req.params.id;
    const user_id = req.user.userId;

    const query = 'DELETE FROM user_vestibulares WHERE user_id = ? AND vestibular_id = ?';
    db.run(query, [user_id, vestibular_id], function (err) {
        if (err) {
            return res.status(500).json({ error: 'Erro ao remover vestibular: ' + err.message });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Vestibular não encontrado na sua lista.' });
        }
        res.json({ message: 'Vestibular removido com sucesso!' });
    });
});

// Rota para listar os vestibulares do usuário
app.get('/user/vestibulares', authenticateToken, (req, res) => {
    const user_id = req.user.userId;

    const query = `
        SELECT v.* 
        FROM vestibulares v
        JOIN user_vestibulares uv ON v.id = uv.vestibular_id
        WHERE uv.user_id = ?
    `;
    db.all(query, [user_id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar vestibulares do usuário: ' + err.message });
        }
        res.json(rows);
    });
});

// Rota para obter o plano atual do usuário
app.get('/user/plan', authenticateToken, (req, res) => {
    const userId = req.user.userId;
    const query = `
        SELECT p.* FROM plans p
        JOIN users u ON u.plan_id = p.id
        WHERE u.id = ?
    `;
    db.get(query, [userId], (err, plan) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar plano: ' + err.message });
        }
        res.json(plan);
    });
});

// Rota para criar uma assinatura no Mercado Pago
app.post('/create-subscription', authenticateToken, async (req, res) => {
    const userId = req.user.userId;
    const { plan_id } = req.body;

    if (!plan_id || ![2, 3].includes(parseInt(plan_id))) {
        return res.status(400).json({ error: 'Plano inválido. Escolha Intermediário (2) ou Premium (3).' });
    }

    db.get('SELECT * FROM plans WHERE id = ?', [plan_id], async (err, plan) => {
        if (err) {
            return res.status(500).json({ error: 'Erro ao buscar plano: ' + err.message });
        }
        if (!plan) {
            return res.status(404).json({ error: 'Plano não encontrado.' });
        }

        try {
            const preferenceData = {
                items: [
                    {
                        title: `Assinatura ${plan.name}`,
                        unit_price: plan.price,
                        quantity: 1,
                        currency_id: 'BRL'
                    }
                ],
                payer: {
                    email: req.user.email
                },
                back_urls: {
                    success: 'http://localhost:3000/dashboard',
                    failure: 'http://localhost:3000/dashboard',
                    pending: 'http://localhost:3000/dashboard'
                },
                auto_return: 'approved',
                notification_url: 'http://localhost:3000/webhook',
                metadata: {
                    user_id: userId,
                    plan_id: plan_id
                }
            };

            const response = await preference.create({ body: preferenceData });
            const paymentUrl = response.init_point;

            db.run('UPDATE users SET plan_id = ? WHERE id = ?', [plan_id, userId], (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Erro ao atualizar plano: ' + err.message });
                }
                res.json({ payment_url: paymentUrl });
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao criar assinatura: ' + error.message });
        }
    });
});

// Rota para receber notificações do Mercado Pago (webhook)
app.post('/webhook', async (req, res) => {
    const payment = req.body;

    if (payment.type === 'payment' && payment.data.id) {
        try {
            const paymentResponse = await paymentClient.get({ id: payment.data.id });
            const status = paymentResponse.status;
            const userId = paymentResponse.metadata?.user_id;
            const planId = paymentResponse.metadata?.plan_id;

            if (status === 'approved' && userId && planId) {
                db.run('UPDATE users SET plan_id = ? WHERE id = ?', [planId, userId], (err) => {
                    if (err) {
                        console.error('Erro ao confirmar plano:', err.message);
                    } else {
                        console.log(`Plano ${planId} confirmado para o usuário ${userId}`);
                    }
                });
            }
        } catch (error) {
            console.error('Erro ao processar webhook:', error.message);
        }
    }

    res.status(200).send('OK');
});

// Função para verificar e enviar alertas
const checkAndSendAlerts = () => {
    db.all(`
        SELECT u.email, v.name, v.institution, v.start_registration, v.end_registration, v.payment_deadline, 
               v.exemption_deadline, v.first_phase_date, v.second_phase_date, v.results_date, 
               v.first_call_date, v.enrollment_date, v.second_call_date
        FROM users u
        JOIN user_vestibulares uv ON u.id = uv.user_id
        JOIN vestibulares v ON uv.vestibular_id = v.id
    `, [], (err, rows) => {
        if (err) {
            console.error('Erro ao buscar dados para alertas:', err.message);
            return;
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0); // Normalizar para o início do dia

        rows.forEach(row => {
            const alertDates = [
                { date: row.start_registration, type: 'Início das Inscrições' },
                { date: row.end_registration, type: 'Fim das Inscrições' },
                { date: row.payment_deadline, type: 'Prazo de Pagamento' },
                { date: row.exemption_deadline, type: 'Prazo de Isenção' },
                { date: row.first_phase_date, type: '1ª Fase' },
                { date: row.second_phase_date, type: '2ª Fase' },
                { date: row.results_date, type: 'Resultados' },
                { date: row.first_call_date, type: '1ª Chamada' },
                { date: row.enrollment_date, type: 'Matrícula' },
                { date: row.second_call_date, type: '2ª Chamada' }
            ];

            alertDates.forEach(alert => {
                if (!alert.date) return; // Ignorar se a data for nula

                const eventDate = new Date(alert.date);
                eventDate.setHours(0, 0, 0, 0); // Normalizar para o início do dia

                const diffDays = Math.floor((eventDate - today) / (1000 * 60 * 60 * 24));

                const alertDays = [1, 2, 3, 7, 10, 15, 20, 30];
                if (alertDays.includes(diffDays) || diffDays === 0) {
                    const subject = `Alerta: ${alert.type} - ${row.name} (${row.institution})`;
                    const text = `Olá! Faltam ${diffDays === 0 ? 'zero dias' : `${diffDays} dia(s)`} para o ${alert.type} do vestibular ${row.name} (${row.institution}). Data: ${alert.date}.`;
                    sendAlertEmail(row.email, subject, text);
                }
            });
        });
    });
};

// Agendar a verificação diária (à meia-noite)
schedule.scheduleJob('0 0 * * *', checkAndSendAlerts);

// Executar imediatamente ao iniciar o servidor
checkAndSendAlerts();

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});