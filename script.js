// --- INICIALIZAÇÃO DO SERVICE WORKER PARA PWA ---
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => console.log('Service Worker registrado com sucesso:', registration))
            .catch(error => console.log('Falha ao registrar Service Worker:', error));
    });
}

document.addEventListener('DOMContentLoaded', () => {

    // --- CONSTANTES E VARIÁVEIS GLOBAIS ---
    const views = document.querySelectorAll('.view');
    const navCards = document.querySelectorAll('.nav-card');
    const homeBtns = document.querySelectorAll('.home-btn');
    const { jsPDF } = window.jspdf;

    let db; // Variável para a instância do banco de dados
    let currentEdit = { store: null, id: null }; // Para controlar o item em edição
    
    const STORES = ['cobrancas', 'fornecedores', 'agenda', 'pessoais'];

    // --- Firebase Variables (initialized after Firebase SDK loads) ---
    let auth;
    let currentUser = null; // Para armazenar o usuário autenticado
    let dbFirestore;

    // --- Firebase UI Elements ---
    const firebaseStatusDot = document.getElementById('firebase-status-dot');
    const firebaseStatusText = document.getElementById('firebase-status-text');
    const firebaseAuthBtn = document.getElementById('firebase-auth-btn');

    // --- NAVEGAÇÃO ENTRE TELAS (VIEWS) ---
    function switchView(viewId) {
        views.forEach(view => {
            view.classList.remove('active');
        });
        const activeView = document.getElementById(viewId);
        if (activeView) {
            activeView.classList.add('active');
        }
    }

    navCards.forEach(card => {
        card.addEventListener('click', () => {
            const viewId = card.getAttribute('data-view');
            if (viewId) switchView(viewId);
        });
    });

    homeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const viewId = btn.getAttribute('data-view');
            if (viewId) switchView(viewId);
        });
    });

    // --- BANCO DE DADOS (INDEXEDDB) ---
    function initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('FinanceiroPWA_DB', 3); 

            request.onupgradeneeded = event => {
                const dbInstance = event.target.result;
                STORES.forEach(storeName => {
                    if (!dbInstance.objectStoreNames.contains(storeName)) {
                        dbInstance.createObjectStore(storeName, { keyPath: 'id', autoIncrement: true });
                    }
                });
                if (!dbInstance.objectStoreNames.contains('config')) {
                   dbInstance.createObjectStore('config', { keyPath: 'id' });
                }
            };

            request.onsuccess = event => {
                db = event.target.result;
                console.log('Banco de dados aberto com sucesso.');
                resolve(db);
            };

            request.onerror = event => {
                console.error('Erro ao abrir o banco de dados:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // --- OPERAÇÕES CRUD NO BANCO DE DADOS E FIREBASE ---
    async function addItem(storeName, item) {
        return new Promise(async (resolve, reject) => {
            if (currentUser) {
                try {
                    const docRef = await window.firebaseFirestore.addDoc(
                        window.firebaseFirestore.collection(window.firebaseFirestore.db, `users/${currentUser.uid}/${storeName}`),
                        item
                    );
                    item.firebaseId = docRef.id;
                } catch (e) {
                    console.error("Erro ao adicionar documento no Firebase: ", e);
                }
            }

            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.add(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getAllItems(storeName) {
        return new Promise(async (resolve, reject) => {
            if (!db) {
                return reject("Banco de dados não inicializado.");
            }
            if (currentUser) {
                 try {
                    const localItems = await new Promise((res, rej) => {
                         const transaction = db.transaction([storeName], 'readonly');
                         const store = transaction.objectStore(storeName);
                         const request = store.getAll();
                         request.onsuccess = () => res(request.result);
                         request.onerror = (e) => rej(e.target.error);
                    });
                     const firebaseDocs = await window.firebaseFirestore.getDocs(
                        window.firebaseFirestore.collection(window.firebaseFirestore.db, `users/${currentUser.uid}/${storeName}`)
                    );
                    const firebaseItems = firebaseDocs.docs.map(doc => ({
                        ...doc.data(),
                        id: doc.data().id, // Manter o ID do IndexedDB
                        firebaseId: doc.id
                    }));
                    
                    const mergedItems = [...localItems, ...firebaseItems].reduce((acc, current) => {
                        const x = acc.find(item => item.firebaseId === current.firebaseId);
                        if (!x) {
                            return acc.concat([current]);
                        } else {
                            return acc;
                        }
                    }, []);

                    const uniqueItems = mergedItems.filter((item, index, self) => 
                        index === self.findIndex((t) => (
                            t.id === item.id || t.firebaseId === item.firebaseId
                        ))
                    );

                    resolve(uniqueItems);
                    return;
                } catch (e) {
                     console.error("Erro ao buscar dados do Firebase: ", e);
                }
            }
            
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function getItem(storeName, id) {
         return new Promise((resolve, reject) => {
            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function updateItem(storeName, item) {
        return new Promise(async (resolve, reject) => {
            if (currentUser && item.firebaseId) {
                try {
                     await window.firebaseFirestore.setDoc(
                        window.firebaseFirestore.doc(window.firebaseFirestore.db, `users/${currentUser.uid}/${storeName}`, item.firebaseId),
                        item
                    );
                } catch (e) {
                    console.error("Erro ao atualizar documento no Firebase: ", e);
                }
            }
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.put(item);
            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async function deleteItem(storeName, id) {
        return new Promise(async (resolve, reject) => {
            const itemToDelete = await getItem(storeName, id);
            if (currentUser && itemToDelete.firebaseId) {
                try {
                    await window.firebaseFirestore.deleteDoc(
                        window.firebaseFirestore.doc(window.firebaseFirestore.db, `users/${currentUser.uid}/${storeName}`, itemToDelete.firebaseId)
                    );
                } catch (e) {
                     console.error("Erro ao deletar documento no Firebase: ", e);
                }
            }
            const transaction = db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // --- OPERAÇÕES DE CONFIGURAÇÃO ---
    function getConfig(key) {
        return new Promise((resolve) => {
            if (!db.objectStoreNames.contains('config')) {
                return resolve(null);
            }
            const transaction = db.transaction(['config'], 'readonly');
            const store = transaction.objectStore('config');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => resolve(null);
        });
    }

    function saveConfig(key, value) {
        return new Promise((resolve, reject) => {
            const transaction = db.transaction(['config'], 'readwrite');
            const store = transaction.objectStore('config');
            const request = store.put({ id: key, value: value });
            request.onsuccess = () => resolve();
            request.onerror = (e) => reject(e.target.error);
        });
    }

    // --- LÓGICA DE RENDERIZAÇÃO E FORMULÁRIOS ---
    async function handleFormSubmit(event, storeName, formId, fieldsMap) {
        event.preventDefault();
        const form = document.getElementById(formId);
        const item = { status: 'pendente' };
        for (const key in fieldsMap) {
            item[key] = document.getElementById(fieldsMap[key]).value;
        }

        if(item.valor) item.valor = parseFloat(item.valor);

        await addItem(storeName, item);
        form.reset();
        await renderAll();
    }

    document.getElementById('form-cobranca').addEventListener('submit', (e) => handleFormSubmit(e, 'cobrancas', 'form-cobranca', {
        cliente: 'cobranca-cliente', tipo: 'cobranca-tipo', vencimento: 'cobranca-vencimento', valor: 'cobranca-valor', pagamento: 'cobranca-pagamento'
    }));
    document.getElementById('form-fornecedor').addEventListener('submit', (e) => handleFormSubmit(e, 'fornecedores', 'form-fornecedor', {
        nome: 'fornecedor-nome', material: 'fornecedor-material', vencimento: 'fornecedor-vencimento', valor: 'fornecedor-valor'
    }));
    document.getElementById('form-agenda').addEventListener('submit', (e) => handleFormSubmit(e, 'agenda', 'form-agenda', {
        cliente: 'agenda-cliente', data: 'agenda-data', horario: 'agenda-horario', compromisso: 'agenda-compromisso'
    }));
    document.getElementById('form-pessoal').addEventListener('submit', (e) => handleFormSubmit(e, 'pessoais', 'form-pessoal', {
        conta: 'pessoal-conta', tipo: 'pessoal-tipo', vencimento: 'pessoal-vencimento', valor: 'pessoal-valor'
    }));

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString + 'T00:00:00-03:00');
        return date.toLocaleDateString('pt-BR');
    }

    function getDaysUntilDue(dateString) {
        if (!dateString) return Infinity;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dueDate = new Date(dateString + 'T00:00:00-03:00');
        const diffTime = dueDate.getTime() - today.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    function createItemCard(storeName, item) {
        const card = document.createElement('div');
        card.className = 'item-card';

        let title, detailsHtml, borderColor;
        const valorFormatado = item.valor ? `R$ ${item.valor.toFixed(2)}` : 'N/A';
        const vencimentoFormatado = formatDate(item.vencimento || item.data);
        const diasAteVencer = getDaysUntilDue(item.vencimento || item.data);

        let dueDateClass = 'due-normal';
        if (diasAteVencer < 0) dueDateClass = 'due-urgent'; // Vencido
        else if (diasAteVencer <= 5) dueDateClass = 'due-soon'; // Vence em breve

        switch(storeName) {
            case 'cobrancas':
                borderColor = 'var(--notif-cobranca)';
                title = item.cliente;
                detailsHtml = `
                    <div class="detail-item"><span>Tipo</span><span>${item.tipo}</span></div>
                    <div class="detail-item"><span>Valor</span><span>${valorFormatado}</span></div>
                    <div class="detail-item"><span>Pagamento</span><span>${item.pagamento}</span></div>
                `;
                break;
            case 'fornecedores':
                borderColor = 'var(--notif-fornecedor)';
                title = item.nome;
                detailsHtml = `
                    <div class="detail-item"><span>Material</span><span>${item.material}</span></div>
                    <div class="detail-item"><span>Valor</span><span>${valorFormatado}</span></div>
                `;
                break;
            case 'agenda':
                borderColor = 'var(--notif-agenda)';
                title = item.cliente;
                detailsHtml = `
                    <div class="detail-item"><span>Horário</span><span>${item.horario}</span></div>
                    <div class="detail-item" style="grid-column: 1 / -1;"><span>Compromisso</span><span>${item.compromisso}</span></div>
                `;
                break;
            case 'pessoais':
                borderColor = 'var(--notif-pessoal)';
                title = item.conta;
                detailsHtml = `
                    <div class="detail-item"><span>Tipo</span><span>${item.tipo}</span></div>
                    <div class="detail-item"><span>Valor</span><span>${valorFormatado}</span></div>
                `;
                break;
        }

        card.style.borderLeftColor = borderColor;

        const isDone = item.status !== 'pendente';
        if (isDone) {
            card.classList.add('status-done');
        }

        const statusTextMap = {
            cobrancas: { pendente: 'Marcar como Enviado', done: 'Reativar Cobrança' },
            fornecedores: { pendente: 'Marcar como Pago', done: 'Reativar Pagamento' },
            agenda: { pendente: 'Marcar como Atendido', done: 'Reativar Compromisso' },
            pessoais: { pendente: 'Marcar como Pago', done: 'Reativar Despesa' },
        };

        card.innerHTML = `
            <div class="item-header">
                <h3>${title}</h3>
                ${(item.vencimento || item.data) ? `<div class="item-due-date ${dueDateClass}">${vencimentoFormatado}</div>` : ''}
            </div>
            <div class="item-details">${detailsHtml}</div>
            <div class="item-actions">
                <button class="btn btn-secondary btn-edit"><i class="ph ph-pencil-simple"></i> Editar</button>
                <button class="btn btn-secondary btn-status">${isDone ? statusTextMap[storeName].done : statusTextMap[storeName].pendente}</button>
                <button class="btn btn-danger btn-delete"><i class="ph ph-trash"></i> Excluir</button>
            </div>
        `;

        card.querySelector('.btn-delete').addEventListener('click', async () => {
            console.log('User confirmed deletion.');
            await deleteItem(storeName, item.id);
            await renderAll();
        });

        card.querySelector('.btn-status').addEventListener('click', async () => {
            item.status = isDone ? 'pendente' : 'done';
            await updateItem(storeName, item);
            await renderAll();
        });

        card.querySelector('.btn-edit').addEventListener('click', () => openEditModal(storeName, item.id));

        return card;
    }

    async function renderList(storeName) {
        let listId;
        if (storeName === 'cobrancas') listId = 'cobranca-list';
        else if (storeName === 'fornecedores') listId = 'fornecedor-list';
        else if (storeName === 'agenda') listId = 'agenda-list';
        else if (storeName === 'pessoais') listId = 'pessoal-list';
        else return;

        const listContainer = document.getElementById(listId);
        if (!listContainer) return;

        listContainer.innerHTML = '';
        const items = await getAllItems(storeName);

        items.sort((a, b) => {
            const dateA = new Date(a.vencimento || a.data);
            const dateB = new Date(b.vencimento || b.data);
            return dateA - dateB;
        });

        if (items.length === 0) {
            listContainer.innerHTML = '<p class="empty-list-message">Nenhum item cadastrado ainda.</p>';
        } else {
            items.forEach(item => {
                listContainer.appendChild(createItemCard(storeName, item));
            });
        }
    }

    // --- LÓGICA DO MODAL DE EDIÇÃO ---
    const modal = document.getElementById('edit-modal');
    const modalForm = document.getElementById('edit-form');

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.remove('visible');
        }
    });

    async function openEditModal(storeName, id) {
        currentEdit = { store: storeName, id: id };
        const item = await getItem(storeName, id);

        let fieldsHtml = '';
        const fieldConfig = {
            cobrancas: [
                { id: 'cliente', label: 'Cliente', value: item.cliente },
                { id: 'tipo', label: 'Tipo', value: item.tipo, type: 'select', options: ['Contrato', 'Boleto de cobrança'] },
                { id: 'vencimento', label: 'Vencimento', value: item.vencimento, type: 'date' },
                { id: 'valor', label: 'Valor', value: item.valor, type: 'number' },
                { id: 'pagamento', label: 'Forma de Pagamento', value: item.pagamento, type: 'select', options: ['Pix', 'Boleto'] },
            ],
            fornecedores: [
                { id: 'nome', label: 'Fornecedor', value: item.nome },
                { id: 'material', label: 'Material', value: item.material },
                { id: 'vencimento', label: 'Vencimento', value: item.vencimento, type: 'date' },
                { id: 'valor', label: 'Valor', value: item.valor, type: 'number' },
            ],
            agenda: [
                 { id: 'cliente', label: 'Cliente', value: item.cliente },
                 { id: 'data', label: 'Data', value: item.data, type: 'date' },
                 { id: 'horario', label: 'Horário', value: item.horario, type: 'time' },
                 { id: 'compromisso', label: 'Compromisso', value: item.compromisso },
            ],
            pessoais: [
                { id: 'conta', label: 'Conta', value: item.conta },
                { id: 'tipo', label: 'Tipo', value: item.tipo, type: 'select', options: ['Fixa', 'Variável'] },
                { id: 'vencimento', label: 'Vencimento', value: item.vencimento, type: 'date' },
                { id: 'valor', label: 'Valor', value: item.valor, type: 'number' },
            ]
        };

        fieldConfig[storeName].forEach(field => {
            if (field.type === 'select') {
                const optionsHtml = field.options.map(opt => `<option value="${opt}" ${opt === field.value ? 'selected' : ''}>${opt}</option>`).join('');
                fieldsHtml += `
                    <div class="input-group">
                        <label for="edit-${field.id}">${field.label}</label>
                        <select id="edit-${field.id}">${optionsHtml}</select>
                    </div>`;
            } else {
                fieldsHtml += `
                    <div class="input-group">
                        <label for="edit-${field.id}">${field.label}</label>
                        <input type="${field.type || 'text'}" id="edit-${field.id}" value="${field.value || ''}">
                    </div>`;
            }
        });

        modalForm.innerHTML = fieldsHtml + `
            <div style="display:flex; gap: 1rem; margin-top: 1rem;">
                <button type="submit" class="btn btn-primary">Salvar Alterações</button>
                <button type="button" class="btn btn-secondary" id="cancel-edit">Cancelar</button>
            </div>
        `;

        modal.classList.add('visible');
        document.getElementById('cancel-edit').addEventListener('click', () => modal.classList.remove('visible'));
        modalForm.onsubmit = async (e) => {
            e.preventDefault();
            const updatedItem = { id: item.id, status: item.status };
            fieldConfig[storeName].forEach(field => {
                updatedItem[field.id] = document.getElementById(`edit-${field.id}`).value;
            });
            if(updatedItem.valor) updatedItem.valor = parseFloat(updatedItem.valor);
            await updateItem(storeName, updatedItem);
            modal.classList.remove('visible');
            await renderAll();
        };
    }

    // --- LÓGICA DO CALENDÁRIO ---
    const calendar = {
        body: document.getElementById('calendar-body'),
        monthYear: document.getElementById('month-year'),
        prevBtn: document.getElementById('prev-month'),
        nextBtn: document.getElementById('next-month'),
        list: document.getElementById('agenda-list'),
        currentDate: new Date(),

        async init() {
            this.prevBtn.addEventListener('click', () => this.changeMonth(-1));
            this.nextBtn.addEventListener('click', () => this.changeMonth(1));
            await this.render();
        },
        async changeMonth(dir) {
            this.currentDate.setMonth(this.currentDate.getMonth() + dir);
            await this.render();
        },
        async render() {
            this.body.innerHTML = '';
            const year = this.currentDate.getFullYear();
            const month = this.currentDate.getMonth();
            this.monthYear.textContent = this.currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
            const firstDay = new Date(year, month, 1).getDay();
            const daysInMonth = new Date(year, month + 1, 0).getDate();
            const agendaItems = await getAllItems('agenda');
            const eventsByDay = {};
            agendaItems.forEach(item => {
                const itemDate = new Date(item.data + 'T00:00:00-03:00');
                if (itemDate.getFullYear() === year && itemDate.getMonth() === month) {
                    const day = itemDate.getDate();
                    if (!eventsByDay[day]) eventsByDay[day] = [];
                    eventsByDay[day].push(item);
                }
            });
            const prevMonthDays = new Date(year, month, 0).getDate();
            for (let i = firstDay; i > 0; i--) {
                const dayCell = document.createElement('div');
                dayCell.className = 'calendar-day other-month';
                dayCell.textContent = prevMonthDays - i + 1;
                this.body.appendChild(dayCell);
            }
            for (let day = 1; day <= daysInMonth; day++) {
                const dayCell = document.createElement('div');
                dayCell.className = 'calendar-day';
                dayCell.textContent = day;
                const today = new Date();
                if (day === today.getDate() && month === today.getMonth() && year === today.getFullYear()) {
                    dayCell.classList.add('today');
                }
                if (eventsByDay[day]) {
                    const dot = document.createElement('div');
                    dot.className = 'event-dot';
                    dayCell.appendChild(dot);
                }
                dayCell.addEventListener('click', () => this.showEventsForDay(day, eventsByDay[day]));
                this.body.appendChild(dayCell);
            }
            const today = new Date();
            if (month === today.getMonth() && year === today.getFullYear()) {
                 this.showEventsForDay(today.getDate(), eventsByDay[today.getDate()]);
            } else {
                 this.showEventsForDay(null, null);
            }
        },
        showEventsForDay(day, events) {
            this.list.innerHTML = '';
            if (events && events.length > 0) {
                 events.sort((a, b) => a.horario.localeCompare(b.horario));
                events.forEach(item => {
                    this.list.appendChild(createItemCard('agenda', item));
                });
            } else {
                this.list.innerHTML = `<p class="empty-list-message">Nenhum compromisso para este dia.</p>`;
            }
        }
    };

    // --- LÓGICA DE NOTIFICAÇÕES E CONFIGURAÇÕES ---
    async function setupNotificationSettings() {
        for (const storeName of STORES) {
            let selectId;
            if (storeName === 'cobrancas') selectId = 'cobranca-notif-days';
            else if (storeName === 'fornecedores') selectId = 'fornecedor-notif-days';
            else if (storeName === 'agenda') selectId = 'agenda-notif-days';
            else if (storeName === 'pessoais') selectId = 'pessoal-notif-days';
            else continue; 

            const select = document.getElementById(selectId);
            if (!select) continue;

            const configKey = `${storeName}_notif_days`;
            const savedValue = await getConfig(configKey);
            if (savedValue) select.value = savedValue;
            
            select.addEventListener('change', async (e) => {
                await saveConfig(configKey, e.target.value);
                console.log(`Configuração de notificação salva. A mudança terá efeito na próxima verificação em segundo plano.`);
            });
        }
    }

    async function updateVisualBadges() {
        let totalAppBadgeCount = 0;
        const badgeConfig = {
            cobrancas: 'cobranca-badge',
            fornecedores: 'fornecedor-badge',
            agenda: 'agenda-badge',
            pessoais: 'pessoal-badge',
        };

        for (const storeName in badgeConfig) {
            const items = await getAllItems(storeName);
            const pendingCount = items.filter(item => item.status === 'pendente').length;
            const badge = document.getElementById(badgeConfig[storeName]);
            if (badge) {
                if (pendingCount > 0) {
                    badge.textContent = pendingCount;
                    badge.classList.add('visible');
                } else {
                    badge.textContent = '0';
                    badge.classList.remove('visible');
                }
            }
            totalAppBadgeCount += pendingCount;
        }

        if ('setAppBadge' in navigator && 'clearAppBadge' in navigator) {
            if (totalAppBadgeCount > 0) {
                await navigator.setAppBadge(totalAppBadgeCount);
            } else {
                await navigator.clearAppBadge();
            }
        }
    }
    
    async function registerPeriodicSync() {
        try {
            const registration = await navigator.serviceWorker.ready;
            if ('periodicSync' in registration) {
                const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
                if (status.state === 'granted') {
                    await registration.periodicSync.register('check-due-dates', {
                        minInterval: 12 * 60 * 60 * 1000, 
                    });
                    console.log('Sincronização periódica de notificações registrada.');
                } else {
                    console.log('Permissão para sincronização periódica não concedida.');
                }
            } else {
                console.warn('Sincronização periódica de fundo não é suportada neste navegador.');
            }
        } catch (error) {
            console.error('Falha ao registrar sincronização periódica:', error);
        }
    }

    // --- GERAÇÃO DE PDF (RELATÓRIO) ---
    async function generateListPdf(storeName) {
        const items = await getAllItems(storeName);
        if (items.length === 0) {
            console.log('Não há itens para gerar um relatório.');
            return;
        }
        const doc = new jsPDF();
        let title = '';
        let head = [];
        const body = [];
        const titleMap = {
            cobrancas: 'Relatório de Cobranças',
            fornecedores: 'Relatório de Fornecedores',
            agenda: 'Relatório de Agenda',
            pessoais: 'Relatório de Despesas Pessoais'
        };
        title = titleMap[storeName];
        switch(storeName) {
            case 'cobrancas':
                head = [['Cliente', 'Vencimento', 'Valor', 'Status']];
                items.forEach(i => body.push([i.cliente, formatDate(i.vencimento), `R$ ${i.valor ? i.valor.toFixed(2) : '0.00'}`, i.status]));
                break;
            case 'fornecedores':
                head = [['Fornecedor', 'Vencimento', 'Valor', 'Status']];
                items.forEach(i => body.push([i.nome, formatDate(i.vencimento), `R$ ${i.valor ? i.valor.toFixed(2) : '0.00'}`, i.status]));
                break;
            case 'agenda':
                head = [['Cliente', 'Data', 'Horário', 'Compromisso', 'Status']];
                items.forEach(i => body.push([i.cliente, formatDate(i.data), i.horario, i.compromisso, i.status]));
                break;
            case 'pessoais':
                head = [['Conta', 'Vencimento', 'Valor', 'Status']];
                items.forEach(i => body.push([i.conta, formatDate(i.vencimento), `R$ ${i.valor ? i.valor.toFixed(2) : '0.00'}`, i.status]));
                break;
        }
        doc.setFontSize(18);
        doc.text(title, 14, 22);
        doc.autoTable({ startY: 30, head: head, body: body, theme: 'grid', headStyles: { fillColor: [41, 128, 185] } });
        doc.save(`relatorio_${storeName}_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pdf`);
    }

    document.getElementById('pdf-cobranca').addEventListener('click', () => generateListPdf('cobrancas'));
    document.getElementById('pdf-fornecedor').addEventListener('click', () => generateListPdf('fornecedores'));
    document.getElementById('pdf-agenda').addEventListener('click', () => generateListPdf('agenda'));
    document.getElementById('pdf-pessoal').addEventListener('click', () => generateListPdf('pessoais'));

    // --- BACKUP E RESTAURAÇÃO ---
    const exportBtn = document.getElementById('export-btn');
    const importBtn = document.getElementById('import-btn');
    const importFile = document.getElementById('import-file');

    exportBtn.addEventListener('click', async () => {
        const backupData = {};
        for (const storeName of STORES) {
            backupData[storeName] = await getAllItems(storeName);
        }
        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_financeiro_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = JSON.parse(e.target.result);
                console.log('User confirmed import. This will overwrite current data.');
                for (const storeName of STORES) {
                    const transaction = db.transaction([storeName], 'readwrite');
                    const store = transaction.objectStore(storeName);
                    await new Promise(resolve => {
                        const req = store.clear();
                        req.onsuccess = resolve;
                    });
                    if (data[storeName]) {
                        for(const item of data[storeName]) {
                            delete item.id;
                            store.add(item);
                        }
                    }
                }
                console.log('Dados importados com sucesso! O aplicativo será recarregado.');
                window.location.reload();
            } catch (error) {
                console.error('Erro ao importar o arquivo. Verifique se o formato é válido:', error);
            }
        };
        reader.readAsText(file);
        importFile.value = '';
    });

    // --- Firebase Authentication Logic (CORRIGIDO) ---
    async function syncDataFromFirebaseToIndexedDB(user) {
        if (!user) return;
        for (const storeName of STORES) {
            try {
                const querySnapshot = await window.firebaseFirestore.getDocs(
                    window.firebaseFirestore.collection(window.firebaseFirestore.db, `users/${user.uid}/${storeName}`)
                );
                
                const transaction = db.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                
                querySnapshot.forEach(doc => {
                    const data = doc.data();
                    const itemToStore = {
                        ...data,
                        id: data.id || Date.now(), // Garante que cada item tenha um ID único para IndexedDB
                        firebaseId: doc.id
                    };
                    store.put(itemToStore);
                });
                
            } catch (e) {
                console.error(`Erro ao sincronizar dados do Firebase para o IndexedDB na store ${storeName}:`, e);
            }
        }
        await renderAll();
    }

    function updateFirebaseAuthUI(user) {
        if (user) {
            firebaseStatusDot.style.backgroundColor = 'var(--color-green)';
            firebaseStatusText.textContent = `Conectado como: ${user.displayName || user.email}`;
            firebaseAuthBtn.innerHTML = '<i class="ph ph-sign-out"></i> Deslogar do Firebase';
            firebaseAuthBtn.classList.remove('btn-danger');
            firebaseAuthBtn.classList.add('btn-primary');
        } else {
            firebaseStatusDot.style.backgroundColor = 'var(--color-red)';
            firebaseStatusText.textContent = 'Status do Firebase: Desconectado';
            firebaseAuthBtn.innerHTML = '<i class="ph ph-google-logo"></i> Logar com Google';
            firebaseAuthBtn.classList.remove('btn-primary');
            firebaseAuthBtn.classList.add('btn-danger');
        }
    }

    firebaseAuthBtn.addEventListener('click', async () => {
        if (currentUser) {
            try {
                await window.signOut(auth);
                console.log('Usuário deslogado com sucesso.');
            } catch (error) {
                console.error('Erro ao deslogar:', error);
            }
        } else {
            const provider = new window.GoogleAuthProvider();
            try {
                const result = await window.signInWithPopup(auth, provider);
                console.log('Login com Google bem-sucedido:', result.user);
                await syncDataFromFirebaseToIndexedDB(result.user);
            } catch (error) {
                console.error('Erro ao fazer login com Google:', error);
                const errorCode = error.code;
                const errorMessage = error.message;
                console.error(`Código: ${errorCode}, Mensagem: ${errorMessage}`);
            }
        }
    });

    // --- FUNÇÃO PRINCIPAL DE RENDERIZAÇÃO ---
    async function renderAll() {
        for (const storeName of STORES) {
            await renderList(storeName);
        }
        await calendar.render();
        await updateVisualBadges();
    }

    // --- INICIALIZAÇÃO DO APP ---
    async function main() {
        await initDB();
        
        // Atraso para garantir que as variáveis do Firebase estejam prontas
        await new Promise(resolve => setTimeout(resolve, 500));
        
        auth = window.firebaseAuth;
        dbFirestore = window.firebaseFirestore.db;

        window.onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            updateFirebaseAuthUI(user);
            await renderAll();
            if (user) {
                await syncDataFromFirebaseToIndexedDB(user);
            }
        });

        await setupNotificationSettings();
        await calendar.init();
        await renderAll();

        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
            await registerPeriodicSync();
        } else {
            console.log('Permissão para notificações não concedida. Alertas não serão exibidos.');
        }
    }
    main();
});
