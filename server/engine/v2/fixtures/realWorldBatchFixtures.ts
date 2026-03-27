export type RealWorldBatchExpectation = {
  citationIndex: number;
  rawStartsWith?: string;
  renderedIncludes?: string;
  referenceType?: string;
};

export type RealWorldBatchFixture = {
  id: string;
  label: string;
  content: string;
  expectedCount: number;
  expectations: RealWorldBatchExpectation[];
};

function stripLeadingNumbering(reference: string): string {
  return reference.replace(/^\s*\d+\.\s+/, '').trim();
}

function buildIndentedNumberedBatch(references: readonly string[], startNumber = 1): string {
  return references
    .map((reference, index) => `${index === 0 ? '' : '   '}${startNumber + index}. ${reference}`)
    .join('\n');
}

const REAL_WORLD_50_REFERENCES = [
  'Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112-128. doi.org',
  'Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org',
  'Rodriguez, M. S. (2021). The role of micro-LEDs in next-generation display technology. Advanced Optical Materials, 9(15), 2100456. doi.org',
  'Thompson, K., & Williams, P. (2024). Re-evaluating the Bretton Woods system in a digital economy. Global Economic Review, 53(1), 15-39. doi.org',
  'Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814-820. doi.org',
  'Gupta, V., & Miller, S. T. (2022). Genomic sequencing and the future of personalized oncology. The Lancet Oncology, 23(11), e512-e524. doi.org',
  'Patel, A. R. (2023). Blockchain applications in secure supply chain management. International Journal of Production Economics, 255, 108682. doi.org',
  'Lee, S. Y., & Kim, Y. J. (2021). Linguistic patterns in social media communication during global crises. Journal of Pragmatics, 178, 145-160. doi.org',
  'Foster, G. L., Hull, P. M., Lunt, D. J., & Zachos, J. C. (2022). Ocean acidification rates in the North Atlantic over the last millennium. Paleoceanography and Paleoclimatology, 37(3), e2021PA004354. doi.org',
  'Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12. doi.org',
  'Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70. doi.org',
  'Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.',
  'Garabaghi, K., & Stuart, C. (2013). Right here, right now: Exploring life-space interventions for children and youth. Don Mills, Ontario: Pearson Education Canada.',
  'Smith, Z. (2017) Swing time. London: Penguin.',
  'Tokarczuk, O. (2019) Drive your plow over the bones of the dead. Translated from the Polish by A. Lloyd-Jones. London: Fitzcarraldo Editions.',
  'Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design. Upper Saddle River, NJ: Addison-Wesley.',
  'Berners-Lee, T., & Fischetti, M. (1999). Weaving the Web: The Original Design and Ultimate Destiny of the World Wide Web. San Francisco: Harper San Francisco.',
  'Knuth, D. E. (1997). The Art of Computer Programming, Volume 1: Fundamental Algorithms (3rd ed.). Boston: Addison-Wesley.',
  'Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA: Addison-Wesley.',
  'Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433-460. doi.org',
  'Shannon, C. E. (1948). A mathematical theory of communication. The Bell System Technical Journal, 27(3), 379-423. doi.org',
  'Einstein, A. (1905). On the electrodynamics of moving bodies. Annalen der Physik, 17(10), 891-921.',
  'Watson, J. D., & Crick, F. H. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737-738. doi.org',
  'Hawking, S. W. (1974). Black hole explosions? Nature, 248(5443), 30-31. doi.org',
  'Darwin, C. (1859). On the Origin of Species by Means of Natural Selection. London: John Murray.',
  'Lovelock, J. E., & Margulis, L. (1974). Atmospheric homeostasis by and for the biosphere: the gaia hypothesis. Tellus, 26(1-2), 2-10. doi.org',
  'Krugman, P. R. (1979). Increasing returns, monopolistic competition, and international trade. Journal of International Economics, 9(4), 469-479. doi.org',
  'Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263-291. doi.org',
  'Fukuyama, F. (1989). The end of history? The National Interest, (16), 3-18.',
  'Chomsky, N. (1957). Syntactic Structures. The Hague: Mouton.',
  'Said, E. W. (1978). Orientalism. New York: Pantheon Books.',
  'Butler, J. (1990). Gender Trouble: Feminism and the Subversion of Identity. New York: Routledge.',
  'Foucault, M. (1975). Discipline and Punish: The Birth of the Prison. Paris: Gallimard.',
  'Bourdieu, P. (1977). Outline of a Theory of Practice. Cambridge: Cambridge University Press.',
  'Habermas, J. (1981). The Theory of Communicative Action. Boston: Beacon Press.',
  'Rawls, J. (1971). A Theory of Justice. Cambridge, MA: Harvard University Press.',
  'Nozick, R. (1974). Anarchy, State, and Utopia. New York: Basic Books.',
  'Sen, A. (1999). Development as Freedom. New York: Oxford University Press.',
  'Picketty, T. (2014). Capital in the Twenty-First Century. Cambridge, MA: Harvard University Press.',
  'Diamond, J. (1997). Guns, Germs, and Steel: The Fates of Human Societies. New York: W.W. Norton & Company.',
  'Harari, Y. N. (2014). Sapiens: A Brief History of Humankind. London: Harvill Secker.',
  'Sassen, S. (1991). The Global City: New York, London, Tokyo. Princeton, NJ: Princeton University Press.',
  'Castells, M. (1996). The Rise of the Network Society. Oxford: Blackwell.',
  'Beck, U. (1992). Risk Society: Towards a New Modernity. London: Sage.',
  'Giddens, A. (1990). The Consequences of Modernity. Stanford, CA: Stanford University Press.',
  'Harvey, D. (1989). The Condition of Postmodernity. Oxford: Blackwell.',
  'Appadurai, A. (1996). Modernity At Large: Cultural Dimensions of Globalization. Minneapolis: University of Minnesota Press.',
  'Latour, B. (1987). Science in Action: How to Follow Scientists and Engineers Through Society. Cambridge, MA: Harvard University Press.',
  'Haraway, D. J. (1991). Simians, Cyborgs, and Women: The Reinvention of Nature. New York: Routledge.',
  'Crenshaw, K. (1989). Demarginalizing the intersection of race and sex. University of Chicago Legal Forum, 1989(1), 139-167.',
] as const;

const NUMBERED_REAL_WORLD_12 = `1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112–128. doi.org
   2. Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org
   3. Rodriguez, M. S. (2021). The role of micro-LEDs in next-generation display technology. Advanced Optical Materials, 9(15), 2100456. doi.org
   4. Thompson, K., & Williams, P. (2024). Re-evaluating the Bretton Woods system in a digital economy. Global Economic Review, 53(1), 15–39. doi.org
   5. Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814–820. doi.org
   6. Gupta, V., & Miller, S. T. (2022). Genomic sequencing and the future of personalized oncology. The Lancet Oncology, 23(11), e512–e524. doi.org
   7. Patel, A. R. (2023). Blockchain applications in secure supply chain management. International Journal of Production Economics, 255, 108682. doi.org
   8. Lee, S. Y., & Kim, Y. J. (2021). Linguistic patterns in social media communication during global crises. Journal of Pragmatics, 178, 145–160. doi.org
   9. Foster, G. L., Hull, P. M., Lunt, D. J., & Zachos, J. C. (2022). Ocean acidification rates in the North Atlantic over the last millennium. Paleoceanography and Paleoclimatology, 37(3), e2021PA004354. doi.org
   10. Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12. doi.org
   11. Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70. doi.org
   12. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.`;

const NUMBERED_REAL_WORLD_150 = `1. Smith, J. A., & Doe, R. B. (2023). Neural network optimization in low-resource environments. Journal of Artificial Intelligence Research, 45(2), 112–128. doi.org
   2. Chen, L., Wang, X., & Liu, Y. (2022). Impact of urban green spaces on mental health: A longitudinal study. Environmental Health Perspectives, 130(4), 047005. doi.org
   3. Rodriguez, M. S. (2021). The role of micro-LEDs in next-generation display technology. Advanced Optical Materials, 9(15), 2100456. doi.org
   4. Thompson, K., & Williams, P. (2024). Re-evaluating the Bretton Woods system in a digital economy. Global Economic Review, 53(1), 15–39. doi.org
   5. Nakamura, H. (2020). Quantum entanglement in macroscopic systems. Nature Physics, 16(8), 814–820. doi.org
   6. Gupta, V., & Miller, S. T. (2022). Genomic sequencing and the future of personalized oncology. The Lancet Oncology, 23(11), e512–e524. doi.org
   7. Patel, A. R. (2023). Blockchain applications in secure supply chain management. International Journal of Production Economics, 255, 108682. doi.org
   8. Lee, S. Y., & Kim, Y. J. (2021). Linguistic patterns in social media communication during global crises. Journal of Pragmatics, 178, 145–160. doi.org
   9. Foster, G. L., Hull, P. M., Lunt, D. J., & Zachos, J. C. (2022). Ocean acidification rates in the North Atlantic over the last millennium. Paleoceanography and Paleoclimatology, 37(3), e2021PA004354. doi.org
   10. Brown, E. (2024). Ethics of autonomous vehicle decision-making frameworks. Ethics and Information Technology, 26(1), 12. doi.org
   11. Bellur, S., Nowak, K. L., & Hull, K. S. (2015). Make it our time: In class multitaskers have lower academic performance. Computers in Human Behavior, 53, 63-70. doi.org
   12. Kennedy, David. New Relations: The Refashioning of British Poetry 1980-1994. Bridgend: Seren, 1996.
   13. Garabaghi, K., & Stuart, C. (2013). Right here, right now: Exploring life-space interventions for children and youth. Don Mills, Ontario: Pearson Education Canada.
   14. Smith, Z. (2017) Swing time. London: Penguin.
   15. Tokarczuk, O. (2019) Drive your plow over the bones of the dead. Translated from the Polish by A. Lloyd-Jones. London: Fitzcarraldo Editions.
   16. Arlow, J., & Neustadt, I. (2005). UML 2 and the Unified Process: Practical Object-Oriented Analysis and Design. Upper Saddle River, NJ: Addison-Wesley.
   17. Berners-Lee, T., & Fischetti, M. (1999). Weaving the Web: The Original Design and Ultimate Destiny of the World Wide Web. San Francisco: Harper San Francisco.
   18. Knuth, D. E. (1997). The Art of Computer Programming, Volume 1: Fundamental Algorithms (3rd ed.). Boston: Addison-Wesley.
   19. Gamma, E., Helm, R., Johnson, R., & Vlissides, J. (1994). Design Patterns: Elements of Reusable Object-Oriented Software. Reading, MA: Addison-Wesley.
   20. Turing, A. M. (1950). Computing machinery and intelligence. Mind, 59(236), 433–460. doi.org
   21. Shannon, C. E. (1948). A mathematical theory of communication. The Bell System Technical Journal, 27(3), 379–423. doi.org
   22. Einstein, A. (1905). On the electrodynamics of moving bodies. Annalen der Physik, 17(10), 891–921.
   23. Watson, J. D., & Crick, F. H. (1953). Molecular structure of nucleic acids: A structure for deoxyribose nucleic acid. Nature, 171(4356), 737–738. doi.org
   24. Hawking, S. W. (1974). Black hole explosions? Nature, 248(5443), 30–31. doi.org
   25. Darwin, C. (1859). On the Origin of Species by Means of Natural Selection. London: John Murray.
   26. Lovelock, J. E., & Margulis, L. (1974). Atmospheric homeostasis by and for the biosphere: the gaia hypothesis. Tellus, 26(1-2), 2–10. doi.org
   27. Krugman, P. R. (1979). Increasing returns, monopolistic competition, and international trade. Journal of International Economics, 9(4), 469–479. doi.org
   28. Kahneman, D., & Tversky, A. (1979). Prospect theory: An analysis of decision under risk. Econometrica, 47(2), 263–291. doi.org
   29. Fukuyama, F. (1989). The end of history? The National Interest, (16), 3–18.
   30. Chomsky, N. (1957). Syntactic Structures. The Hague: Mouton.
   31. Said, E. W. (1978). Orientalism. New York: Pantheon Books.
   32. Butler, J. (1990). Gender Trouble: Feminism and the Subversion of Identity. New York: Routledge.
   33. Foucault, M. (1975). Discipline and Punish: The Birth of the Prison. Paris: Gallimard.
   34. Bourdieu, P. (1977). Outline of a Theory of Practice. Cambridge: Cambridge University Press.
   35. Habermas, J. (1981). The Theory of Communicative Action. Boston: Beacon Press.
   36. Rawls, J. (1971). A Theory of Justice. Cambridge, MA: Harvard University Press.
   37. Nozick, R. (1974). Anarchy, State, and Utopia. New York: Basic Books.
   38. Sen, A. (1999). Development as Freedom. New York: Oxford University Press.
   39. Picketty, T. (2014). Capital in the Twenty-First Century. Cambridge, MA: Harvard University Press.
   40. Diamond, J. (1997). Guns, Germs, and Steel: The Fates of Human Societies. New York: W.W. Norton & Company.
   41. Harari, Y. N. (2014). Sapiens: A Brief History of Humankind. London: Harvill Secker.
   42. Sassen, S. (1991). The Global City: New York, London, Tokyo. Princeton, NJ: Princeton University Press.
   43. Castells, M. (1996). The Rise of the Network Society. Oxford: Blackwell.
   44. Beck, U. (1992). Risk Society: Towards a New Modernity. London: Sage.
   45. Giddens, A. (1990). The Consequences of Modernity. Stanford, CA: Stanford University Press.
   46. Harvey, D. (1989). The Condition of Postmodernity. Oxford: Blackwell.
   47. Appadurai, A. (1996). Modernity At Large: Cultural Dimensions of Globalization. Minneapolis: University of Minnesota Press.
   48. Latour, B. (1987). Science in Action: How to Follow Scientists and Engineers Through Society. Cambridge, MA: Harvard University Press.
   49. Haraway, D. J. (1991). Simians, Cyborgs, and Women: The Reinvention of Nature. New York: Routledge.
   50. Crenshaw, K. (1989). Demarginalizing the intersection of race and sex. University of Chicago Legal Forum, 1989(1), 139–167.
   51. Spivak, G. C. (1988). Can the subaltern speak? In C. Nelson & L. Grossberg (Eds.), Marxism and the Interpretation of Culture (pp. 271–313). Urbana: University of Illinois Press.
   52. Bhabha, H. K. (1994). The Location of Culture. London: Routledge.
   53. Gilroy, P. (1993). The Black Atlantic: Modernity and Double Consciousness. Cambridge, MA: Harvard University Press.
   54. Mbembe, A. (2003). Necropolitics. Public Culture, 15(1), 11–40. doi.org
   55. Agamben, G. (1998). Homo Sacer: Sovereign Power and Bare Life. Stanford, CA: Stanford University Press.
   56. Žižek, S. (1989). The Sublime Object of Ideology. London: Verso.
   57. Deleuze, G., & Guattari, F. (1980). A Thousand Plateaus: Capitalism and Schizophrenia. Minneapolis: University of Minnesota Press.
   58. Baudrillard, J. (1981). Simulacra and Simulation. Ann Arbor: University of Michigan Press.
   59. Jameson, F. (1991). Postmodernism, or, The Cultural Logic of Late Capitalism. Durham, NC: Duke University Press.
   60. Hall, S. (1973). Encoding and Decoding in the Television Discourse. Birmingham: Centre for Contemporary Cultural Studies.
   61. Williams, R. (1958). Culture and Society, 1780-1950. London: Chatto & Windus.
   62. Thompson, E. P. (1963). The Making of the English Working Class. London: Victor Gollancz.
   63. Hobsbawm, E. J. (1962). The Age of Revolution: 1789-1848. London: Weidenfeld & Nicolson.
   64. Anderson, B. (1983). Imagined Communities: Reflections on the Origin and Spread of Nationalism. London: Verso.
   65. Wallerstein, I. (1974). The Modern World-System. New York: Academic Press.
   66. Polanyi, K. (1944). The Great Transformation: The Political and Economic Origins of Our Time. New York: Farrar & Rinehart.
   67. Schumpeter, J. A. (1942). Capitalism, Socialism and Democracy. New York: Harper & Brothers.
   68. Hayek, F. A. (1944). The Road to Serfdom. Chicago: University of Chicago Press.
   69. Keynes, J. M. (1936). The General Theory of Employment, Interest, and Money. London: Macmillan.
   70. Friedman, M. (1962). Capitalism and Freedom. Chicago: University of Chicago Press.
   71. Stiglitz, J. E. (2002). Globalization and Its Discontents. New York: W.W. Norton & Company.
   72. Sachs, J. D. (2005). The End of Poverty: Economic Possibilities for Our Time. New York: Penguin Press.
   73. Easterly, W. (2001). The Elusive Quest for Growth. Cambridge, MA: MIT Press.
   74. Acemoglu, D., & Robinson, J. A. (2012). Why Nations Fail: The Origins of Power, Prosperity, and Poverty. New York: Crown Publishers.
   75. North, D. C. (1990). Institutions, Institutional Change and Economic Performance. Cambridge: Cambridge University Press.
   76. Coase, R. H. (1937). The nature of the firm. Economica, 4(16), 386–405. doi.org
   77. Ostrom, E. (1990). Governing the Commons: The Evolution of Institutions for Collective Action. Cambridge: Cambridge University Press.
   78. Hardin, G. (1968). The tragedy of the commons. Science, 162(3859), 1243–1248. doi.org
   79. Olson, M. (1965). The Logic of Collective Action: Public Goods and the Theory of Groups. Cambridge, MA: Harvard University Press.
   80. Putnam, R. D. (2000). Bowling Alone: The Collapse and Revival of American Community. New York: Simon & Schuster.
   81. Coleman, J. S. (1988). Social capital in the creation of human capital. American Journal of Sociology, 94, S95–S120.
   82. Granovetter, M. S. (1973). The strength of weak ties. American Journal of Sociology, 78(6), 1360–1380.
   83. Burt, R. S. (1992). Structural Holes: The Social Structure of Competition. Cambridge, MA: Harvard University Press.
   84. Goffman, E. (1959). The Presentation of Self in Everyday Life. Garden City, NY: Doubleday.
   85. Garfinkel, H. (1967). Studies in Ethnomethodology. Englewood Cliffs, NJ: Prentice-Hall.
   86. Berger, P. L., & Luckmann, T. (1966). The Social Construction of Reality. Garden City, NY: Doubleday.
   87. Mead, G. H. (1934). Mind, Self, and Society. Chicago: University of Chicago Press.
   88. Blumer, H. (1969). Symbolic Interactionism: Perspective and Method. Englewood Cliffs, NJ: Prentice-Hall.
   89. Parsons, T. (1951). The Social System. Glencoe, IL: Free Press.
   90. Merton, R. K. (1949). Social Theory and Social Structure. Glencoe, IL: Free Press.
   91. Durkheim, É. (1893). The Division of Labour in Society. Paris: Félix Alcan.
   92. Weber, M. (1905). The Protestant Ethic and the Spirit of Capitalism. Tübingen: Mohr Siebeck.
   93. Marx, K. (1867). Capital, Volume I. Hamburg: Otto Meissner.
   94. Simmel, G. (1903). The Metropolis and Mental Life. In The Sociology of Georg Simmel. New York: Free Press.
   95. Du Bois, W. E. B. (1903). The Souls of Black Folk. Chicago: A.C. McClurg & Co.
   96. Fanon, F. (1952). Black Skin, White Masks. Paris: Éditions du Seuil.
   97. Freire, P. (1970). Pedagogy of the Oppressed. New York: Herder and Herder.
   98. Illich, I. (1971). Deschooling Society. New York: Harper & Row.
   99. Postman, N. (1985). Amusing Ourselves to Death: Public Discourse in the Age of Show Business. New York: Viking.
   100. McLuhan, M. (1964). Understanding Media: The Extensions of Man. New York: McGraw-Hill.
   101. Barthes, R. (1957). Mythologies. Paris: Éditions du Seuil.
   102. Derrida, J. (1967). Of Grammatology. Paris: Éditions de Minuit.
   103. Lacan, J. (1966). Écrits. Paris: Éditions du Seuil.
   104. Kristeva, J. (1980). Desire in Language: A Semiotic Approach to Literature and Art. New York: Columbia University Press.
   105. Irigaray, L. (1974). Speculum of the Other Woman. Paris: Éditions de Minuit.
   106. Cixous, H. (1975). The laugh of the Medusa. Signs, 1(4), 875–893.
   107. Mohanty, C. T. (1984). Under Western eyes: Feminist scholarship and colonial discourses. Boundary 2, 12/13, 333–358.
   108. Anzaldúa, G. (1987). Borderlands/La Frontera: The New Mestiza. San Francisco: Spinsters/Aunt Lute.
   109. Hooks, B. (1981). Ain't I a Woman? Black Women and Feminism. Boston: South End Press.
   110. Lorde, A. (1984). Sister Outsider: Essays and Speeches. Trumansburg, NY: Crossing Press.
   111. Walker, A. (1983). In Search of Our Mothers' Gardens: Womanist Prose. San Diego: Harcourt Brace Jovanovich.
   112. Morrison, T. (1987). Beloved. New York: Alfred A. Knopf.
   113. Baldwin, J. (1963). The Fire Next Time. New York: Dial Press.
   114. Wright, R. (1940). Native Son. New York: Harper & Brothers.
   115. Ellison, R. (1952). Invisible Man. New York: Random House.
   116. Angelou, M. (1969). I Know Why the Caged Bird Sings. New York: Random House.
   117. Tan, A. (1989). The Joy Luck Club. New York: Putnam.
   118. Kingston, M. H. (1976). The Woman Warrior: Memoirs of a Girlhood Among Ghosts. New York: Alfred A. Knopf.
   119. Rushdie, S. (1981). Midnight's Children. London: Jonathan Cape.
   120. Achebe, C. (1958). Things Fall Apart. London: William Heinemann.
   121. Ngũgĩ wa Thiong'o. (1986). Decolonising the Mind: The Politics of Language in African Literature. London: James Currey.
   122. Roy, A. (1997). The God of Small Things. New Delhi: IndiaInk.
   123. Ishiguro, K. (1989). The Remains of the Day. London: Faber and Faber.
   124. Coetzee, J. M. (1999). Disgrace. London: Secker & Warburg.
   125. Gordimer, N. (1981). July's People. London: Jonathan Cape.
   126. Marquez, G. G. (1967). One Hundred Years of Solitude. Buenos Aires: Editorial Sudamericana.
   127. Borges, J. L. (1944). Ficciones. Buenos Aires: Sur.
   128. Neruda, P. (1924). Twenty Love Poems and a Song of Despair. Santiago: Nascimento.
   129. Allende, I. (1982). The House of the Spirits. Barcelona: Plaza & Janés.
   130. Saramago, J. (1995). Blindness. Lisbon: Caminho.
   131. Pamuk, O. (1998). My Name Is Red. Istanbul: İletişim Yayınları.
   132. Murakami, H. (1987). Norwegian Wood. Tokyo: Kodansha.
   133. Kundera, M. (1984). The Unbearable Lightness of Being. Paris: Gallimard.
   134. Eco, U. (1980). The Name of the Rose. Milan: Bompiani.
   135. Calvino, I. (1972). Invisible Cities. Turin: Einaudi.
   136. Perec, G. (1978). Life: A User's Manual. Paris: Hachette.
   137. Sebald, W. G. (1995). The Rings of Saturn. Frankfurt am Main: Eichborn.
   138. Bolaño, R. (2004). 2666. Barcelona: Anagrama.
   139. Knausgård, K. O. (2009). My Struggle. Oslo: Oktober.
   140. Ferrante, E. (2011). My Brilliant Friend. Rome: Edizioni e/o.
   141. Atwood, M. (1985). The Handmaid's Tale. Toronto: McClelland & Stewart.
   142. Munro, A. (2001). Hateship, Friendship, Courtship, Loveship, Marriage. Toronto: Douglas Gibson Books.
   143. Ondaatje, M. (1992). The English Patient. Toronto: McClelland & Stewart.
   144. Martel, Y. (2001). Life of Pi. Toronto: Knopf Canada.
   145. Franzen, J. (2001). The Corrections. New York: Farrar, Straus and Giroux.
   146. Wallace, D. F. (1996). Infinite Jest. Boston: Little, Brown.
   147. DeLillo, D. (1997). Underworld. New York: Scribner.
   148. McCarthy, C. (2006). The Road. New York: Alfred A. Knopf.
   149. Robinson, M. (2004). Gilead. New York: Farrar, Straus and Giroux.
   150. Didion, J. (2005). The Year of Magical Thinking. New York: Alfred A. Knopf.`;

const REAL_WORLD_150_REFERENCES = NUMBERED_REAL_WORLD_150
  .split(/\r?\n/)
  .map(stripLeadingNumbering);

const REAL_WORLD_450 = [
  REAL_WORLD_150_REFERENCES.join('\n\n'),
  buildIndentedNumberedBatch(REAL_WORLD_150_REFERENCES, 151),
  buildIndentedNumberedBatch(REAL_WORLD_150_REFERENCES, 301),
].join('\n\n');

export const REAL_WORLD_BATCH_FIXTURES: readonly RealWorldBatchFixture[] = [
  {
    id: 'real-world-450',
    label: '450-reference mixed real-world corpus',
    content: REAL_WORLD_450,
    expectedCount: 450,
    expectations: [
      { citationIndex: 0, renderedIncludes: 'Smith, J. A., & Doe, R. B. (2023).' },
      { citationIndex: 11, renderedIncludes: 'New Relations: The Refashioning of British Poetry 1980-1994', referenceType: 'book' },
      { citationIndex: 149, renderedIncludes: 'The Year of Magical Thinking.', referenceType: 'book' },
      { citationIndex: 150, rawStartsWith: '151. Smith,' },
      { citationIndex: 299, rawStartsWith: '300. Didion,' },
      { citationIndex: 300, rawStartsWith: '301. Smith,' },
      { citationIndex: 449, rawStartsWith: '450. Didion,' },
      { citationIndex: 22, renderedIncludes: 'Watson, J. D., & Crick, F. H. (1953).' },
    ],
  },
  {
    id: 'numbered-real-world-12',
    label: '12-reference indented numbered corpus',
    content: NUMBERED_REAL_WORLD_12,
    expectedCount: 12,
    expectations: [
      { citationIndex: 0, rawStartsWith: '1. Smith,' },
      { citationIndex: 10, rawStartsWith: '11. Bellur,' },
      { citationIndex: 11, rawStartsWith: '12. Kennedy,', referenceType: 'book' },
    ],
  },
  {
    id: 'numbered-real-world-150',
    label: '150-reference indented numbered corpus',
    content: NUMBERED_REAL_WORLD_150,
    expectedCount: 150,
    expectations: [
      { citationIndex: 0, rawStartsWith: '1. Smith,' },
      { citationIndex: 11, rawStartsWith: '12. Kennedy,' },
      { citationIndex: 49, rawStartsWith: '50. Crenshaw,' },
      { citationIndex: 99, rawStartsWith: '100. McLuhan,' },
      { citationIndex: 149, rawStartsWith: '150. Didion,', referenceType: 'book' },
    ],
  },
];
