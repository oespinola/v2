import { chmod, mkdir } from 'node:fs/promises';
import qrcode from 'qrcode-terminal';
import wwebjs from 'whatsapp-web.js';
import type { Message } from 'whatsapp-web.js';
import type { AlertImage, IncomingEdit, IncomingMessage } from './types.ts';

const { Client, LocalAuth } = wwebjs;

export interface WhatsAppOptions {
  authDir: string;
  groupName: string;
  onMessage: (msg: IncomingMessage) => void;
  onEdit: (edit: IncomingEdit) => void;
  onDisconnected: (reason: string) => void;
}

// Busca el grupo en la página sin serializar todos los chats: getChats() y getChatById()
// fallan con "r: r" en este grupo (error interno de groupMetadata en WhatsApp Web).
// Ojo: lo que va dentro de evaluate() corre en el navegador; no definir funciones con
// nombre adentro (tsx las envuelve con __name, que allá no existe).
async function findGroupId(client: wwebjs.Client, name: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const id = await client.pupPage!.evaluate((groupName) => {
      const chats = (globalThis as any).require('WAWebCollections').Chat.getModelsArray();
      const group = chats.find((c: any) => c.groupMetadata && c.formattedTitle === groupName);
      return group ? (group.id._serialized as string) : null;
    }, name);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

async function listGroupNames(client: wwebjs.Client): Promise<string[]> {
  return client.pupPage!.evaluate(() =>
    (globalThis as any)
      .require('WAWebCollections')
      .Chat.getModelsArray()
      .filter((c: any) => c.groupMetadata)
      .map((c: any) => c.formattedTitle as string),
  );
}

async function senderName(msg: Message): Promise<string | null> {
  try {
    const contact = await msg.getContact();
    return contact.pushname ?? contact.name ?? null;
  } catch {
    return null;
  }
}

// "201502803152967:1@lid" → "201502803152967@lid": el ":1" es el dispositivo que mandó
// el mensaje y cambia según desde dónde escriba la persona.
export function withoutDevice(id: string): string {
  return id.replace(/:\d+@/, '@');
}

async function toIncoming(msg: Message, client: wwebjs.Client): Promise<IncomingMessage> {
  return {
    // Parte única del ID: es la misma venga el mensaje en vivo o del historial.
    waMessageId: msg.id.id ?? msg.id._serialized,
    senderId: withoutDevice(msg.fromMe ? (msg.author ?? client.info.wid._serialized) : (msg.author ?? msg.from)),
    senderName: await senderName(msg),
    body: msg.body, // en mensajes con imagen, wwebjs ya trae acá el caption
    receivedAt: new Date(),
    hasMedia: msg.hasMedia,
    downloadImage: async (): Promise<AlertImage | null> => {
      const media = await msg.downloadMedia();
      return media ? { data: media.data, mimeType: media.mimetype } : null;
    },
  };
}

// RF-06: si no hay sesión guardada, muestra el QR para vincular la cuenta.
// Solo escucha mensajes nuevos: no relee el historial al arrancar, para no operar
// alertas viejas (y RF-29 cubre los reenvíos).
export async function startWhatsApp(opts: WhatsAppOptions): Promise<wwebjs.Client> {
  await mkdir(opts.authDir, { recursive: true, mode: 0o700 });
  await chmod(opts.authDir, 0o700);

  const client = new Client({ authStrategy: new LocalAuth({ dataPath: opts.authDir }) });

  client.on('qr', (qr) => {
    console.log('Escaneá este QR con WhatsApp (Dispositivos vinculados):');
    qrcode.generate(qr, { small: true });
  });

  client.on('ready', async () => {
    const groupId = await findGroupId(client, opts.groupName);
    if (!groupId) {
      console.error(`No encontré el grupo "${opts.groupName}". Tus grupos:`);
      for (const name of await listGroupNames(client)) console.error(`  - ${name}`);
      opts.onDisconnected('grupo no encontrado');
      return;
    }
    console.log(`WhatsApp listo. Escuchando "${opts.groupName}".`);
    // message_create incluye los mensajes de la propia cuenta vinculada (el evento
    // "message" los omite); así el operador puede probar mandando alertas él mismo.
    client.on('message_create', async (msg) => {
      const chatId = msg.fromMe ? msg.to : msg.from;
      if (chatId !== groupId) return;
      opts.onMessage(await toIncoming(msg, client));
    });

    // Ediciones (como en capture.ts de la v1): se registran, no se operan.
    client.on('message_edit', (msg, newBody, prevBody) => {
      const chatId = msg.fromMe ? msg.to : msg.from;
      if (chatId !== groupId) return;
      opts.onEdit({
        waMessageId: msg.id.id ?? msg.id._serialized,
        senderId: withoutDevice(msg.fromMe ? (msg.author ?? client.info.wid._serialized) : (msg.author ?? msg.from)),
        prevBody: String(prevBody),
        newBody: String(newBody),
        editedAt: new Date(),
      });
    });
  });

  client.on('disconnected', (reason) => opts.onDisconnected(String(reason)));

  await client.initialize();
  return client;
}
