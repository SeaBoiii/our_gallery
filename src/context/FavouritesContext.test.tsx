import { fireEvent,render,screen } from '@testing-library/react'
import { describe,expect,it } from 'vitest'
import { FavouritesProvider,FAVOURITES_STORAGE_KEY,MAX_FAVOURITES } from './FavouritesContext'
import { useFavourites } from './useFavourites'

function Probe(){ const value=useFavourites();return <><output>{value.ids.join(',')}</output><button onClick={()=>value.toggleFavourite('memory-new')}>toggle</button></> }

describe('local favourites',()=>{
  it('recovers from corrupt storage',()=>{
    localStorage.setItem(FAVOURITES_STORAGE_KEY,'not-json')
    render(<FavouritesProvider><Probe/></FavouritesProvider>)
    expect(screen.getByRole('status').textContent).toBe('')
  })
  it('stores IDs only and enforces the cap',()=>{
    localStorage.setItem(FAVOURITES_STORAGE_KEY,JSON.stringify(Array.from({length:MAX_FAVOURITES+20},(_,index)=>`memory-${index}`)))
    render(<FavouritesProvider><Probe/></FavouritesProvider>)
    expect(screen.getByRole('status').textContent?.split(',')).toHaveLength(MAX_FAVOURITES)
    fireEvent.click(screen.getByRole('button',{ name:'toggle' }))
    const stored=JSON.parse(localStorage.getItem(FAVOURITES_STORAGE_KEY) || '[]') as string[]
    expect(stored).toHaveLength(MAX_FAVOURITES)
    expect(stored[0]).toBe('memory-new')
  })
})
