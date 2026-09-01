// EXPORTS: IPackage, MOCK_PACKAGES
export interface IPackage {
  id: string
  name: string
  price: number
  credits: number
  bonus?: string
  tag?: string
}

export const MOCK_PACKAGES: IPackage[] = [
  {
    id: '1',
    name: '入门套餐',
    price: 49,
    credits: 3300,
    bonus: '赠200积分',
  },
  {
    id: '2',
    name: '进阶套餐',
    price: 99,
    credits: 8300,
    bonus: '赠500积分',
    tag: '热销',
  },
  {
    id: '3',
    name: '专业套餐',
    price: 199,
    credits: 20000,
    bonus: '赠1500积分',
    tag: '推荐',
  },
  {
    id: '4',
    name: '企业套餐',
    price: 499,
    credits: 68000,
    bonus: '赠5000积分',
  },
]