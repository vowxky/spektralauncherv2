import { invoke } from '@tauri-apps/api/core'

export const getInstances = async (): Promise<Instance[]> => {
  try {
    const data = await invoke<any[]>('get_instances')
    return data as Instance[]
  } catch (err) {
    console.error('Error fetching instances', err)
    throw err
  }
}

export const getInstance = async ({ id, slug }: { id?: string, slug?: string }): Promise<Instance> => {
  if (!id && !slug) throw new Error('No se especifico ninguna instancia')

  try {
    const data = await invoke<any>('get_instance', {
      id: id ?? null,
      slug: slug ?? null,
    })
    return data as Instance
  } catch (err) {
    console.error('Error fetching instance', err)
    throw err
  }
}