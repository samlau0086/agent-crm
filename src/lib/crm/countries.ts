export type CountryDevelopmentTier = "advanced" | "high_income" | "upper_middle_income" | "lower_middle_income" | "low_income";

export type CountryOption = {
  code: string;
  name: string;
  zhName: string;
  developmentTier: CountryDevelopmentTier;
  developmentLabel: string;
};

export const countryOptions: CountryOption[] = [
  { code: "US", name: "United States", zhName: "美国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "CH", name: "Switzerland", zhName: "瑞士", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "SG", name: "Singapore", zhName: "新加坡", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "DK", name: "Denmark", zhName: "丹麦", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "IE", name: "Ireland", zhName: "爱尔兰", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "NO", name: "Norway", zhName: "挪威", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "AU", name: "Australia", zhName: "澳大利亚", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "NL", name: "Netherlands", zhName: "荷兰", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "SE", name: "Sweden", zhName: "瑞典", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "DE", name: "Germany", zhName: "德国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "CA", name: "Canada", zhName: "加拿大", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "FI", name: "Finland", zhName: "芬兰", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "BE", name: "Belgium", zhName: "比利时", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "NZ", name: "New Zealand", zhName: "新西兰", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "AT", name: "Austria", zhName: "奥地利", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "JP", name: "Japan", zhName: "日本", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "GB", name: "United Kingdom", zhName: "英国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "LU", name: "Luxembourg", zhName: "卢森堡", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "KR", name: "South Korea", zhName: "韩国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "FR", name: "France", zhName: "法国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "IL", name: "Israel", zhName: "以色列", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "ES", name: "Spain", zhName: "西班牙", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "IT", name: "Italy", zhName: "意大利", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "CY", name: "Cyprus", zhName: "塞浦路斯", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "AE", name: "United Arab Emirates", zhName: "阿拉伯联合酋长国", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "MT", name: "Malta", zhName: "马耳他", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "SI", name: "Slovenia", zhName: "斯洛文尼亚", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "CZ", name: "Czechia", zhName: "捷克", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "EE", name: "Estonia", zhName: "爱沙尼亚", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "PT", name: "Portugal", zhName: "葡萄牙", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "GR", name: "Greece", zhName: "希腊", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "SK", name: "Slovakia", zhName: "斯洛伐克", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "LT", name: "Lithuania", zhName: "立陶宛", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "LV", name: "Latvia", zhName: "拉脱维亚", developmentTier: "advanced", developmentLabel: "Advanced economy" },
  { code: "IS", name: "Iceland", zhName: "冰岛", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "QA", name: "Qatar", zhName: "卡塔尔", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "SA", name: "Saudi Arabia", zhName: "沙特阿拉伯", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "BN", name: "Brunei", zhName: "文莱", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "BH", name: "Bahrain", zhName: "巴林", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "KW", name: "Kuwait", zhName: "科威特", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "OM", name: "Oman", zhName: "阿曼", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "PL", name: "Poland", zhName: "波兰", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "HU", name: "Hungary", zhName: "匈牙利", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "HR", name: "Croatia", zhName: "克罗地亚", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "RO", name: "Romania", zhName: "罗马尼亚", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "CL", name: "Chile", zhName: "智利", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "UY", name: "Uruguay", zhName: "乌拉圭", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "PA", name: "Panama", zhName: "巴拿马", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "BB", name: "Barbados", zhName: "巴巴多斯", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "BS", name: "Bahamas", zhName: "巴哈马", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "AG", name: "Antigua and Barbuda", zhName: "安提瓜和巴布达", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "KN", name: "Saint Kitts and Nevis", zhName: "圣基茨和尼维斯", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "TT", name: "Trinidad and Tobago", zhName: "特立尼达和多巴哥", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "SC", name: "Seychelles", zhName: "塞舌尔", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "MU", name: "Mauritius", zhName: "毛里求斯", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "SM", name: "San Marino", zhName: "圣马力诺", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "MC", name: "Monaco", zhName: "摩纳哥", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "AD", name: "Andorra", zhName: "安道尔", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "LI", name: "Liechtenstein", zhName: "列支敦士登", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "VA", name: "Holy See", zhName: "梵蒂冈", developmentTier: "high_income", developmentLabel: "High income economy" },
  { code: "CN", name: "China", zhName: "中国", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MY", name: "Malaysia", zhName: "马来西亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "TR", name: "Turkey", zhName: "土耳其", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MX", name: "Mexico", zhName: "墨西哥", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BR", name: "Brazil", zhName: "巴西", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "AR", name: "Argentina", zhName: "阿根廷", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "CR", name: "Costa Rica", zhName: "哥斯达黎加", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "TH", name: "Thailand", zhName: "泰国", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "KZ", name: "Kazakhstan", zhName: "哈萨克斯坦", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "RS", name: "Serbia", zhName: "塞尔维亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "ME", name: "Montenegro", zhName: "黑山", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BG", name: "Bulgaria", zhName: "保加利亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "RU", name: "Russia", zhName: "俄罗斯", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BY", name: "Belarus", zhName: "白俄罗斯", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "AL", name: "Albania", zhName: "阿尔巴尼亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MK", name: "North Macedonia", zhName: "北马其顿", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BA", name: "Bosnia and Herzegovina", zhName: "波斯尼亚和黑塞哥维那", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "AM", name: "Armenia", zhName: "亚美尼亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "AZ", name: "Azerbaijan", zhName: "阿塞拜疆", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "GE", name: "Georgia", zhName: "格鲁吉亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MD", name: "Moldova", zhName: "摩尔多瓦", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "PE", name: "Peru", zhName: "秘鲁", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "CO", name: "Colombia", zhName: "哥伦比亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "EC", name: "Ecuador", zhName: "厄瓜多尔", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "DO", name: "Dominican Republic", zhName: "多米尼加共和国", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "JM", name: "Jamaica", zhName: "牙买加", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BZ", name: "Belize", zhName: "伯利兹", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "GY", name: "Guyana", zhName: "圭亚那", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "SR", name: "Suriname", zhName: "苏里南", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "PY", name: "Paraguay", zhName: "巴拉圭", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "ZA", name: "South Africa", zhName: "南非", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "BW", name: "Botswana", zhName: "博茨瓦纳", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "NA", name: "Namibia", zhName: "纳米比亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "GA", name: "Gabon", zhName: "加蓬", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "GQ", name: "Equatorial Guinea", zhName: "赤道几内亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "LY", name: "Libya", zhName: "利比亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "DZ", name: "Algeria", zhName: "阿尔及利亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "IQ", name: "Iraq", zhName: "伊拉克", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "IR", name: "Iran", zhName: "伊朗", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "JO", name: "Jordan", zhName: "约旦", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "LB", name: "Lebanon", zhName: "黎巴嫩", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MV", name: "Maldives", zhName: "马尔代夫", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "ID", name: "Indonesia", zhName: "印度尼西亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "VN", name: "Vietnam", zhName: "越南", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MN", name: "Mongolia", zhName: "蒙古", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "TM", name: "Turkmenistan", zhName: "土库曼斯坦", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "FJ", name: "Fiji", zhName: "斐济", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "TO", name: "Tonga", zhName: "汤加", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "WS", name: "Samoa", zhName: "萨摩亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "TV", name: "Tuvalu", zhName: "图瓦卢", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "NR", name: "Nauru", zhName: "瑙鲁", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "MH", name: "Marshall Islands", zhName: "马绍尔群岛", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "PW", name: "Palau", zhName: "帕劳", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "FM", name: "Micronesia", zhName: "密克罗尼西亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "CU", name: "Cuba", zhName: "古巴", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "DM", name: "Dominica", zhName: "多米尼克", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "GD", name: "Grenada", zhName: "格林纳达", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "LC", name: "Saint Lucia", zhName: "圣卢西亚", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "VC", name: "Saint Vincent and the Grenadines", zhName: "圣文森特和格林纳丁斯", developmentTier: "upper_middle_income", developmentLabel: "Upper-middle income economy" },
  { code: "IN", name: "India", zhName: "印度", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "PH", name: "Philippines", zhName: "菲律宾", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "EG", name: "Egypt", zhName: "埃及", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "MA", name: "Morocco", zhName: "摩洛哥", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "TN", name: "Tunisia", zhName: "突尼斯", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "UA", name: "Ukraine", zhName: "乌克兰", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "LK", name: "Sri Lanka", zhName: "斯里兰卡", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "PK", name: "Pakistan", zhName: "巴基斯坦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "BD", name: "Bangladesh", zhName: "孟加拉国", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "UZ", name: "Uzbekistan", zhName: "乌兹别克斯坦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "KG", name: "Kyrgyzstan", zhName: "吉尔吉斯斯坦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "TJ", name: "Tajikistan", zhName: "塔吉克斯坦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "NP", name: "Nepal", zhName: "尼泊尔", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "BT", name: "Bhutan", zhName: "不丹", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "KH", name: "Cambodia", zhName: "柬埔寨", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "LA", name: "Laos", zhName: "老挝", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "MM", name: "Myanmar", zhName: "缅甸", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "TL", name: "Timor-Leste", zhName: "东帝汶", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "PS", name: "Palestine", zhName: "巴勒斯坦领土", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "SY", name: "Syria", zhName: "叙利亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "YE", name: "Yemen", zhName: "也门", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "HN", name: "Honduras", zhName: "洪都拉斯", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "SV", name: "El Salvador", zhName: "萨尔瓦多", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "GT", name: "Guatemala", zhName: "危地马拉", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "NI", name: "Nicaragua", zhName: "尼加拉瓜", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "BO", name: "Bolivia", zhName: "玻利维亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "VE", name: "Venezuela", zhName: "委内瑞拉", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "GH", name: "Ghana", zhName: "加纳", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "CI", name: "Cote d'Ivoire", zhName: "科特迪瓦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "NG", name: "Nigeria", zhName: "尼日利亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "KE", name: "Kenya", zhName: "肯尼亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "CM", name: "Cameroon", zhName: "喀麦隆", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "CG", name: "Republic of the Congo", zhName: "刚果（布）", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "AO", name: "Angola", zhName: "安哥拉", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "ZM", name: "Zambia", zhName: "赞比亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "ZW", name: "Zimbabwe", zhName: "津巴布韦", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "LS", name: "Lesotho", zhName: "莱索托", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "SZ", name: "Eswatini", zhName: "斯威士兰", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "CV", name: "Cabo Verde", zhName: "佛得角", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "ST", name: "Sao Tome and Principe", zhName: "圣多美和普林西比", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "KM", name: "Comoros", zhName: "科摩罗", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "DJ", name: "Djibouti", zhName: "吉布提", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "MR", name: "Mauritania", zhName: "毛里塔尼亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "SN", name: "Senegal", zhName: "塞内加尔", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "TZ", name: "Tanzania", zhName: "坦桑尼亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "PG", name: "Papua New Guinea", zhName: "巴布亚新几内亚", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "SB", name: "Solomon Islands", zhName: "所罗门群岛", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "VU", name: "Vanuatu", zhName: "瓦努阿图", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "KI", name: "Kiribati", zhName: "基里巴斯", developmentTier: "lower_middle_income", developmentLabel: "Lower-middle income economy" },
  { code: "AF", name: "Afghanistan", zhName: "阿富汗", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "ET", name: "Ethiopia", zhName: "埃塞俄比亚", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "UG", name: "Uganda", zhName: "乌干达", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "RW", name: "Rwanda", zhName: "卢旺达", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "MZ", name: "Mozambique", zhName: "莫桑比克", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "MG", name: "Madagascar", zhName: "马达加斯加", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "MW", name: "Malawi", zhName: "马拉维", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "NE", name: "Niger", zhName: "尼日尔", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "ML", name: "Mali", zhName: "马里", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "BF", name: "Burkina Faso", zhName: "布基纳法索", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "TD", name: "Chad", zhName: "乍得", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "CF", name: "Central African Republic", zhName: "中非共和国", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "CD", name: "Democratic Republic of the Congo", zhName: "刚果（金）", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "BI", name: "Burundi", zhName: "布隆迪", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "SS", name: "South Sudan", zhName: "南苏丹", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "SD", name: "Sudan", zhName: "苏丹", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "ER", name: "Eritrea", zhName: "厄立特里亚", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "SO", name: "Somalia", zhName: "索马里", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "SL", name: "Sierra Leone", zhName: "塞拉利昂", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "LR", name: "Liberia", zhName: "利比里亚", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "GN", name: "Guinea", zhName: "几内亚", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "GW", name: "Guinea-Bissau", zhName: "几内亚比绍", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "GM", name: "Gambia", zhName: "冈比亚", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "TG", name: "Togo", zhName: "多哥", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "BJ", name: "Benin", zhName: "贝宁", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "HT", name: "Haiti", zhName: "海地", developmentTier: "low_income", developmentLabel: "Low income economy" },
  { code: "KP", name: "North Korea", zhName: "朝鲜", developmentTier: "low_income", developmentLabel: "Low income economy" },
];

const countryByName = new Map(countryOptions.map((country) => [country.name.toLowerCase(), country]));
const countryByCode = new Map(countryOptions.map((country) => [country.code.toLowerCase(), country]));
const countryByZhName = new Map(countryOptions.map((country) => [country.zhName.toLowerCase(), country]));

export function getCountrySelectOptions(): Array<{ label: string; value: string; meta: string }> {
  return countryOptions.map((country) => ({
    label: country.zhName === country.name ? country.name : `${country.zhName} / ${country.name}`,
    value: country.name,
    meta: `${country.code} - ${country.developmentLabel}`
  }));
}

export function resolveCountry(value: unknown): CountryOption | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  return countryByName.get(normalized) ?? countryByCode.get(normalized) ?? countryByZhName.get(normalized);
}

export function getCountryLabel(value: unknown): string {
  const country = resolveCountry(value);
  if (country) {
    return country.zhName === country.name ? country.name : `${country.zhName} / ${country.name}`;
  }

  return typeof value === "string" ? value : "";
}

export function isCountryValue(value: unknown): boolean {
  return Boolean(resolveCountry(value));
}

