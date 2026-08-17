const connect = async () => {
  const ws = new WebSocket(`ws://${import.meta.env.VITE_API_HOST || location.host}`);
  ws.onopen = () => {
    return ws
  }
  ws.onerror = (error) => {
    console.log('Error al conectar al servidor:', error);
    throw ws
  }
}
const ws = await connect() as unknown as WebSocket;

export const getUser = () => {
  return new Promise((resolve, reject) => {
    ws.onmessage = (event) => {
      if (event.data[0] === 'user') {
        return resolve(event.data.slice(1));
      }
    }
    ws.onerror = (error) => {
      console.log('Error al obtener el usuario:', error);
      reject(error);
    }
    ws.send('user');
  })
}