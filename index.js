require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
const nodemailer = require('nodemailer');
const schedule = require('node-schedule');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'seu_segredo_jwt'; // Fallback caso não esteja no .env

// Configurar o Mercado Pago
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

// Configurar o PostgreSQL (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false // Necessário para conexões externas como Neon
    }
});

// Testar conexão com o banco ao iniciar
pool.connect((err) => {
    if (err) {
        console.error('Erro ao conectar ao banco de dados:', {
            message: err.message,
            stack: err.stack
        });
        process.exit(1); // Encerra o processo se a conexão falhar
    } else {
        console.log('Conexão com o banco de dados estabelecida com sucesso!');
    }
});

// Criar tabelas e inserir dados iniciais
pool.query(`
    CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        whatsapp_number TEXT NOT NULL,
        password TEXT NOT NULL,
        plan_id INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        limit_vestibulares INTEGER NOT NULL,
        price REAL
    );

    CREATE TABLE IF NOT EXISTS vestibulares (
        id SERIAL PRIMARY KEY,
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
    );

    CREATE TABLE IF NOT EXISTS user_vestibulares (
        user_id INTEGER,
        vestibular_id INTEGER,
        PRIMARY KEY (user_id, vestibular_id),
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (vestibular_id) REFERENCES vestibulares(id)
    );
`, (err) => {
    if (err) {
        console.error('Erro ao criar tabelas:', {
            message: err.message,
            stack: err.stack
        });
    } else {
        console.log('Tabelas criadas com sucesso!');

        // Inserir planos
        pool.query(`
            INSERT INTO plans (name, limit_vestibulares, price)
            VALUES ('Grátis', 2, 0.0), ('Intermediário', 6, 9.99), ('Premium', -1, 19.99)
            ON CONFLICT (id) DO NOTHING;
        `, (err) => {
            if (err) console.error('Erro ao inserir planos:', err.message);
            else console.log('Planos inseridos com sucesso!');
        });

        // Inserir vestibulares
        pool.query(`
            INSERT INTO vestibulares (name, institution, start_registration, end_registration, payment_deadline, exemption_deadline, first_phase_date, second_phase_date, results_date, first_call_date, enrollment_date, second_call_date)
            VALUES 
                ('ENEM 2025', 'MEC', '2025-05-01', '2025-06-01', '2025-06-05', '2025-04-15', '2025-11-02', '2025-11-09', '2026-01-15', '2026-02-01', '2026-02-15', '2026-03-01'),
                ('Fuvest 2025', 'USP', '2025-04-15', '2025-05-15', '2025-05-20', '2025-04-10', '2025-11-20', '2025-12-15', '2026-01-20', '2026-02-05', '2026-02-20', '2026-03-05'),
                ('Unicamp 2025', 'Unicamp', '2025-05-10', '2025-06-10', '2025-06-15', '2025-05-05', '2025-11-25', '2025-12-18', '2026-01-25', '2026-02-10', '2026-02-25', '2026-03-10')
            ON CONFLICT (id) DO NOTHING;
        `, (err) => {
            if (err) console.error('Erro ao inserir vestibulares:', err.message);
            else console.log('Vestibulares inseridos com sucesso!');
        });
    }
});

// Configurar o Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Middleware para verificar o token JWT
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Token inválido.' });
    }
};

// Rota para cadastrar usuário
app.post('/register', async (req, res) => {
    const { name, email, whatsapp_number, password } = req.body;

    if (!name || !email || !whatsapp_number || !password) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const query = 'INSERT INTO users (name, email, whatsapp_number, password) VALUES ($1, $2, $3, $4) RETURNING id';
        const result = await pool.query(query, [name, email, whatsapp_number, hashedPassword]);
        const userId = result.rows[0].id;
        const token = jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '24h' });
        res.status(201).json({ 
            message: 'Usuário cadastrado com sucesso!', 
            userId,
            token
        });
    } catch (error) {
        console.error('Erro ao cadastrar usuário:', error.message);
        res.status(500).json({ error: 'Erro ao cadastrar usuário: ' + error.message });
    }
});

// Rota para login
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

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
        console.error('Erro ao processar login:', error.message);
        res.status(500).json({ error: 'Erro ao processar requisição: ' + error.message });
    }
});

// Rota para listar vestibulares
app.get('/vestibulares', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM vestibulares');
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar vestibulares:', error.message);
        res.status(500).json({ error: 'Erro ao buscar vestibulares: ' + error.message });
    }
});

// Rota para obter informações do usuário
app.get('/user', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.userId]);
        const user = result.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }
        const planResult = await pool.query('SELECT * FROM plans WHERE id = $1', [user.plan_id]);
        const plan = planResult.rows[0];
        res.json({ user, plan });
    } catch (error) {
        console.error('Erro ao buscar usuário:', error.message);
        res.status(500).json({ error: 'Erro ao buscar usuário: ' + error.message });
    }
});

// Rota para selecionar vestibulares
app.post('/user/vestibulares', authenticateToken, async (req, res) => {
    const { vestibular_id } = req.body;
    const userId = req.user.userId;

    if (!vestibular_id) {
        return res.status(400).json({ error: 'Vestibular ID é obrigatório.' });
    }

    try {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        const user = userResult.rows[0];
        if (!user) {
            return res.status(404).json({ error: 'Usuário não encontrado.' });
        }

        const planResult = await pool.query('SELECT * FROM plans WHERE id = $1', [user.plan_id]);
        const plan = planResult.rows[0];

        const selectedVestibularesResult = await pool.query('SELECT COUNT(*) FROM user_vestibulares WHERE user_id = $1', [userId]);
        const selectedCount = parseInt(selectedVestibularesResult.rows[0].count);

        if (plan.limit_vestibulares !== -1 && selectedCount >= plan.limit_vestibulares) {
            return res.status(403).json({ error: `Limite de vestibulares atingido para o plano ${plan.name}. Faça upgrade para selecionar mais.` });
        }

        await pool.query('INSERT INTO user_vestibulares (user_id, vestibular_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, vestibular_id]);
        res.json({ message: 'Vestibular selecionado com sucesso!' });
    } catch (error) {
        console.error('Erro ao selecionar vestibular:', error.message);
        res.status(500).json({ error: 'Erro ao selecionar vestibular: ' + error.message });
    }
});

// Rota para obter vestibulares selecionados pelo usuário
app.get('/user/vestibulares', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT v.* 
            FROM vestibulares v 
            JOIN user_vestibulares uv ON v.id = uv.vestibular_id 
            WHERE uv.user_id = $1
        `, [req.user.userId]);
        res.json(result.rows);
    } catch (error) {
        console.error('Erro ao buscar vestibulares selecionados:', error.message);
        res.status(500).json({ error: 'Erro ao buscar vestibulares selecionados: ' + error.message });
    }
});

// Rota para criar preferência de pagamento
app.post('/create-preference', async (req, res) => {
    const { plan_id } = req.body;

    try {
        const planResult = await pool.query('SELECT * FROM plans WHERE id = $1', [plan_id]);
        const plan = planResult.rows[0];
        if (!plan) {
            return res.status(404).json({ error: 'Plano não encontrado.' });
        }

        const preferenceData = {
            items: [
                {
                    title: `Plano ${plan.name}`,
                    quantity: 1,
                    currency_id: 'BRL',
                    unit_price: plan.price
                }
            ],
            back_urls: {
                success: 'https://vestibular-alerts.vercel.app/success',
                failure: 'https://vestibular-alerts.vercel.app/failure',
                pending: 'https://vestibular-alerts.vercel.app/pending'
            },
            auto_return: 'approved'
        };

        const result = await preference.create({ body: preferenceData });
        res.json({ preferenceId: result.id });
    } catch (error) {
        console.error('Erro ao criar preferência de pagamento:', error.message);
        res.status(500).json({ error: 'Erro ao criar preferência de pagamento: ' + error.message });
    }
});

// Rota para processar webhook do Mercado Pago
app.post('/webhook', async (req, res) => {
    const paymentId = req.body.data?.id;

    if (!paymentId) {
        return res.status(400).json({ error: 'ID de pagamento não fornecido.' });
    }

    try {
        const payment = await paymentClient.get({ id: paymentId });
        if (payment.status === 'approved') {
            const userId = payment.metadata?.user_id;
            const planId = payment.metadata?.plan_id;

            if (userId && planId) {
                await pool.query('UPDATE users SET plan_id = $1 WHERE id = $2', [planId, userId]);
            }
        }
        res.status(200).send('Webhook processado com sucesso.');
    } catch (error) {
        console.error('Erro ao processar webhook:', error.message);
        res.status(500).json({ error: 'Erro ao processar webhook: ' + error.message });
    }
});

// Função para enviar e-mails de alerta
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

// Agendar alertas
const scheduleAlerts = async () => {
    try {
        const usersResult = await pool.query('SELECT * FROM users');
        const users = usersResult.rows;

        for (const user of users) {
            const selectedVestibularesResult = await pool.query(`
                SELECT v.* 
                FROM vestibulares v 
                JOIN user_vestibulares uv ON v.id = uv.vestibular_id 
                WHERE uv.user_id = $1
            `, [user.id]);
            const selectedVestibulares = selectedVestibularesResult.rows;

            for (const vestibular of selectedVestibulares) {
                const datesToAlert = [
                    { date: vestibular.start_registration, label: 'Início das inscrições' },
                    { date: vestibular.end_registration, label: 'Fim das inscrições' },
                    { date: vestibular.payment_deadline, label: 'Prazo de pagamento' },
                    { date: vestibular.exemption_deadline, label: 'Prazo para isenção' },
                    { date: vestibular.first_phase_date, label: 'Primeira fase' },
                    { date: vestibular.second_phase_date, label: 'Segunda fase' },
                    { date: vestibular.results_date, label: 'Resultados' },
                    { date: vestibular.first_call_date, label: 'Primeira chamada' },
                    { date: vestibular.enrollment_date, label: 'Matrícula' },
                    { date: vestibular.second_call_date, label: 'Segunda chamada' }
                ];

                for (const { date, label } of datesToAlert) {
                    if (date) {
                        const alertDate = new Date(date);
                        alertDate.setDate(alertDate.getDate() - 1); // Alerta 1 dia antes
                        schedule.scheduleJob(alertDate, async () => {
                            await sendAlertEmail(
                                user.email,
                                `Alerta: ${label} - ${vestibular.name}`,
                                `Olá ${user.name},\n\nAmanhã é o ${label} do vestibular ${vestibular.name} (${vestibular.institution}).\nNão perca!`
                            );
                        });
                    }
                }
            }
        }
        console.log('Agendamento de alertas configurado com sucesso!');
    } catch (error) {
        console.error('Erro ao agendar alertas:', error.message);
    }
};

// Executar agendamento de alertas ao iniciar o servidor
scheduleAlerts();

// Iniciar o servidor (para testes locais, mas não necessário no Vercel)
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Servidor rodando na porta ${PORT}`);
    });
}