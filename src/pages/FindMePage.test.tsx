import { fireEvent,render,screen,waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach,describe,expect,it,vi } from 'vitest'
import { FavouritesProvider } from '../context/FavouritesContext'
import { LocaleProvider } from '../context/LocaleContext'
import FindMePage from './FindMePage'
import type { GalleryMedia } from '../../shared/contracts'

const api=vi.hoisted(()=>({
  getFindMeAvailability:vi.fn(),
  findMyMemories:vi.fn(),
  getGalleryMedia:vi.fn(),
}))
vi.mock('../services/api',()=>({ ...api,GalleryApiError:class GalleryApiError extends Error { code:string;constructor(message:string,code:string){ super(message);this.code=code } } }))

const memory:GalleryMedia={
  id:'00000000-0000-4000-8000-000000000041',mediaType:'photo',mimeType:'image/jpeg',width:1200,height:900,durationSeconds:null,
  guestName:'A guest',guestMessage:null,source:'guest',createdAt:'2027-08-21T00:00:00.000Z',thumbnailUrl:'https://media.test/thumb',displayUrl:'https://media.test/display',altText:'A guest smiling beside the stage.',
  event:{ id:'event-solemnisation',slug:'solemnisation',name:'solemnisation',eventDate:'2027-08-21',displayName:'Solemnisation',uploadEnabled:true },categories:[],
}

describe('Find Me consent flow',()=>{
  beforeEach(()=>{
    api.getFindMeAvailability.mockReset().mockResolvedValue({ available:true,provider:'mock',modelVersion:'mock-v1',maxImageBytes:6*1024**2,sessionTtlSeconds:600 })
    api.findMyMemories.mockReset().mockResolvedValue({ searchSessionId:'session',expiresAt:new Date().toISOString(),strongMatches:[],possibleMatches:[],totalMatches:0 })
    api.getGalleryMedia.mockReset().mockResolvedValue(memory)
    Object.defineProperty(URL,'createObjectURL',{ configurable:true,value:vi.fn(()=> 'blob:selfie') })
    Object.defineProperty(URL,'revokeObjectURL',{ configurable:true,value:vi.fn() })
  })

  it('keeps consent unchecked and never searches before opt-in',async()=>{
    const { container }=render(<LocaleProvider><FavouritesProvider><MemoryRouter><FindMePage/></MemoryRouter></FavouritesProvider></LocaleProvider>)
    await screen.findByRole('heading',{ name:'Find Your Seat in Our Memories' })
    const consent=screen.getByRole('checkbox',{ name:'I understand and want to search.' })
    expect(consent).not.toBeChecked()
    const input=container.querySelector('input[capture="user"]') as HTMLInputElement
    fireEvent.change(input,{ target:{ files:[new File(['selfie'],'selfie.jpg',{ type:'image/jpeg' })] } })
    await screen.findByAltText('Selfie ready. Review it before searching.')
    const submit=screen.getByRole('button',{ name:'Find My Memories' })
    expect(submit).toBeDisabled()
    expect(api.findMyMemories).not.toHaveBeenCalled()
    fireEvent.click(consent)
    fireEvent.click(submit)
    await waitFor(()=>expect(api.findMyMemories).toHaveBeenCalledTimes(1))
    await screen.findByRole('heading',{ name:"We couldn't find a strong match yet." })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:selfie')
    expect(input).toHaveAttribute('tabindex','-1')
  })

  it('announces successful results and opens a memory before its URL refresh completes',async()=>{
    let finishRefresh:(value:GalleryMedia)=>void=()=>undefined
    api.findMyMemories.mockResolvedValue({ searchSessionId:'result-session',expiresAt:new Date().toISOString(),strongMatches:[{ ...memory,similarity:.9,matchStrength:'strong' }],possibleMatches:[],totalMatches:1 })
    api.getGalleryMedia.mockReturnValue(new Promise<GalleryMedia>((resolve)=>{ finishRefresh=resolve }))
    const { container }=render(<LocaleProvider><FavouritesProvider><MemoryRouter><FindMePage/></MemoryRouter></FavouritesProvider></LocaleProvider>)
    await screen.findByRole('heading',{ name:'Find Your Seat in Our Memories' })
    fireEvent.change(container.querySelector('input[capture="user"]') as HTMLInputElement,{ target:{ files:[new File(['selfie'],'selfie.jpg',{ type:'image/jpeg' })] } })
    await screen.findByAltText('Selfie ready. Review it before searching.')
    fireEvent.click(screen.getByRole('checkbox',{ name:'I understand and want to search.' }))
    fireEvent.click(screen.getByRole('button',{ name:'Find My Memories' }))
    const heading=await screen.findByRole('heading',{ name:'We Found You ✨' })
    await waitFor(()=>expect(heading.parentElement).toHaveFocus())
    fireEvent.click(screen.getByRole('button',{ name:'Open: A guest smiling beside the stage.' }))
    expect(screen.getByRole('dialog',{ name:'Memory viewer' })).toBeInTheDocument()
    finishRefresh(memory)
  })
})
